import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ClassifiedError } from "../utils.js";
import { classifyError } from "../utils.js";

export interface RunnerOptions {
  cwd: string;
  model: string;
  prompt: string;
  sessionId?: string | null;
  timeoutMs: number;
  signal?: AbortSignal;
  onEvent?: (event: RunnerEvent) => void;
}

export type RunnerEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "step"; tokens: number; cost: number }
  | { type: "log"; line: string };

export interface RunnerResult {
  ok: boolean;
  sessionId: string | null;
  text: string;
  tokens: number;
  cost: number;
  error?: ClassifiedError;
  timedOut?: boolean;
}

export interface RunnerHandle {
  result: Promise<RunnerResult>;
  kill: () => void;
}

const RUNTIME_DIR = path.join(os.homedir(), ".mecut", "runtime");

const AUTONOMY_PREFIX = [
  "MODE OTONOM (mecut). Kamu sedang berjalan dalam loop otomatis tanpa manusia di depan terminal.",
  "ATURAN WAJIB:",
  "1. JANGAN pernah bertanya, meminta konfirmasi, atau menunggu jawaban. Tidak ada yang akan menjawab.",
  "2. Jangan menampilkan opsi pilihan atau pertanyaan balik. Ambil keputusan terbaik sendiri dan langsung kerjakan.",
  "3. Selalu langsung mengubah/membuat file yang diperlukan memakai tools. Jangan hanya menjelaskan rencana.",
  "4. Bila ada hal ambigu, pilih pendekatan paling masuk akal dan lanjutkan.",
  "5. Selesaikan pekerjaan hingga tuntas, verifikasi bila memungkinkan, lalu berhenti dengan ringkasan singkat.",
  "6. Ini iterasi berulang: pertahankan perbaikan yang sudah ada, jangan merusak hasil sebelumnya, tingkatkan secara bertahap.",
].join("\n");

export function runOnce(binary: string, opts: RunnerOptions): RunnerHandle {
  const fullPrompt = `${AUTONOMY_PREFIX}\n\nTUGAS:\n${opts.prompt}`;
  const args = ["run", fullPrompt, "--format", "json", "-m", opts.model, "--dir", opts.cwd, "--auto"];
  if (opts.sessionId) args.push("--session", opts.sessionId);

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const outFile = path.join(RUNTIME_DIR, `iter-${process.pid}-${Date.now()}.jsonl`);
  const errFile = path.join(RUNTIME_DIR, `iter-${process.pid}-${Date.now()}.err`);
  const outFd = fs.openSync(outFile, "w");
  const errFd = fs.openSync(errFile, "w");

  let sessionId: string | null = opts.sessionId ?? null;
  let text = "";
  let tokens = 0;
  let cost = 0;
  let timedOut = false;
  let killed = false;
  let lastErrorLine = "";

  const child = spawn(binary, args, {
    cwd: opts.cwd,
    stdio: ["ignore", outFd, errFd],
    windowsHide: true,
    env: { ...process.env, OPENCODE_DISABLE_AUTOUPDATE: "true" },
  });

  fs.closeSync(outFd);
  fs.closeSync(errFd);

  let offset = 0;
  let buffer = "";

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("{")) {
      lastErrorLine = trimmed;
      opts.onEvent?.({ type: "log", line: trimmed });
      return;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (parsed.sessionID && !sessionId) {
      sessionId = parsed.sessionID;
      opts.onEvent?.({ type: "session", sessionId: parsed.sessionID });
    }
    switch (parsed.type) {
      case "text": {
        const t = parsed.part?.text ?? "";
        if (t) {
          text += t;
          opts.onEvent?.({ type: "text", text: t });
        }
        break;
      }
      case "step_finish": {
        const tk = parsed.part?.tokens;
        const total =
          (tk?.input ?? 0) + (tk?.output ?? 0) + (tk?.reasoning ?? 0) + (tk?.cache?.read ?? 0);
        const c = parsed.part?.cost ?? 0;
        tokens += total;
        cost += c;
        opts.onEvent?.({ type: "step", tokens: total, cost: c });
        break;
      }
      case "error": {
        const msg =
          parsed.part?.error?.data?.message ??
          parsed.error?.data?.message ??
          parsed.part?.error?.message ??
          parsed.error?.message ??
          parsed.part?.error?.name ??
          parsed.error?.name ??
          parsed.part?.text ??
          "error event";
        lastErrorLine = String(msg);
        opts.onEvent?.({ type: "log", line: String(msg) });
        break;
      }
      default:
        break;
    }
  };

  const pump = () => {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(outFile);
    } catch {
      return;
    }
    if (stat.size <= offset) return;
    const stream = fs.createReadStream(outFile, { start: offset, end: stat.size - 1 });
    let chunk = "";
    stream.on("data", (d) => (chunk += d.toString()));
    stream.on("end", () => {
      offset = stat.size;
      buffer += chunk;
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      for (const line of parts) handleLine(line);
    });
  };

  const pumpTimer = setInterval(pump, 400);

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 4000);
  }, opts.timeoutMs);

  const onAbort = () => {
    killed = true;
    child.kill("SIGTERM");
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  const result = new Promise<RunnerResult>((resolve) => {
    const finish = (exitCode: number | null) => {
      clearInterval(pumpTimer);
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);

      try {
        const stat = fs.statSync(outFile);
        if (stat.size > offset) {
          buffer += fs.readFileSync(outFile).subarray(offset).toString("utf8");
          offset = stat.size;
        }
      } catch {
        // ignore
      }
      if (buffer.trim()) {
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() ?? "";
        for (const line of parts) handleLine(line);
        if (buffer.trim()) handleLine(buffer);
        buffer = "";
      }

      {
        let stderrText = "";
        try {
          stderrText = fs.readFileSync(errFile, "utf8");
        } catch {
          // ignore
        }
        try {
          fs.unlinkSync(outFile);
          fs.unlinkSync(errFile);
        } catch {
          // ignore
        }

        if (killed) {
          resolve({
            ok: false,
            sessionId,
            text,
            tokens,
            cost,
            error: { kind: "unknown", message: "Dibatalkan oleh pengguna", retriable: false },
          });
          return;
        }
        if (timedOut) {
          resolve({
            ok: false,
            sessionId,
            text,
            tokens,
            cost,
            timedOut: true,
            error: {
              kind: "timeout",
              message: `Iterasi melebihi batas ${Math.round(opts.timeoutMs / 1000)}s`,
              retriable: true,
            },
          });
          return;
        }
        if (exitCode !== 0) {
          const message = lastErrorLine || stderrText || `opencode keluar dengan kode ${exitCode}`;
          resolve({ ok: false, sessionId, text, tokens, cost, error: classifyError(message) });
          return;
        }
        resolve({ ok: true, sessionId, text, tokens, cost });
      }
    };

    child.on("exit", (code) => finish(code));
    child.on("error", (err) => {
      lastErrorLine = String(err);
      finish(1);
    });
  });

  return {
    result,
    kill: () => {
      killed = true;
      child.kill("SIGTERM");
    },
  };
}
