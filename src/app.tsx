import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import type { Config } from "./config.js";
import { saveConfig, type SavedModel } from "./config.js";
import { StatusBar } from "./components/StatusBar.js";
import { ModelPicker } from "./components/ModelPicker.js";
import { ProviderWizard } from "./components/ProviderWizard.js";
import { Summary } from "./components/Summary.js";
import { getMergedModels, splitModelId, type MergedModel } from "./core/models.js";
import { findOpencodeBinary } from "./core/opencode.js";
import { runLoop, type IterationRecord, type LoopResult, type LoopStatus } from "./core/loop.js";
import { formatDuration, formatMoney, formatTokens, parseDuration } from "./utils.js";

type Phase = "durasi" | "prompt" | "siap" | "loop" | "selesai";

interface AppProps {
  initialConfig: Config;
  cwd: string;
  flags: {
    durationMs?: number;
    model?: string;
    retryMs?: number;
  };
}

interface Notice {
  id: number;
  message: string;
  kind: "info" | "error" | "success";
}

const INITIAL_STATUS: LoopStatus = {
  iteration: 0,
  okCount: 0,
  failCount: 0,
  consecutiveErrors: 0,
  totalTokens: 0,
  totalCost: 0,
  sessionId: null,
  currentDelayMs: 0,
  phase: "idle",
};

export function App({ initialConfig, cwd, flags }: AppProps) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();

  const [config, setConfig] = useState<Config>(initialConfig);
  const [phase, setPhase] = useState<Phase>(flags.durationMs ? "prompt" : "durasi");
  const [buffer, setBuffer] = useState("");
  const [durationMs, setDurationMs] = useState<number>(flags.durationMs ?? initialConfig.durationMs);
  const [retryDelayMs, setRetryDelayMs] = useState<number>(flags.retryMs ?? initialConfig.retryDelayMs);
  const [prompt, setPrompt] = useState("");
  const [draftModel, setDraftModel] = useState<string>(flags.model ?? initialConfig.activeModel);
  const [lockedModel, setLockedModel] = useState<string>("");
  const [models, setModels] = useState<MergedModel[]>([]);
  const [overlay, setOverlay] = useState<"none" | "model" | "provider">("none");
  const [status, setStatus] = useState<LoopStatus>(INITIAL_STATUS);
  const [iterations, setIterations] = useState<IterationRecord[]>([]);
  const [result, setResult] = useState<LoopResult | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [now, setNow] = useState(Date.now());
  const [showHelp, setShowHelp] = useState(false);

  const deadlineRef = useRef<number>(0);
  const loopStartRef = useRef<number>(0);
  const extraTimeRef = useRef<number>(0);
  const retryRef = useRef<number>(retryDelayMs);
  const abortRef = useRef<AbortController | null>(null);
  const binaryRef = useRef<string>("");
  const noticeId = useRef(0);

  useEffect(() => {
    retryRef.current = retryDelayMs;
  }, [retryDelayMs]);

  const notify = useCallback((message: string, kind: Notice["kind"] = "info") => {
    noticeId.current += 1;
    const id = noticeId.current;
    setNotices((prev) => [...prev.slice(-3), { id, message, kind }]);
    setTimeout(() => {
      setNotices((prev) => prev.filter((n) => n.id !== id));
    }, 5000);
  }, []);

  useEffect(() => {
    void (async () => {
      binaryRef.current = await findOpencodeBinary();
      const merged = await getMergedModels(config);
      setModels(merged);
      if (!draftModel && merged.length > 0) setDraftModel(merged[0].id);
    })();
  }, []);

  useEffect(() => {
    if (phase !== "loop") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [phase]);

  const persist = useCallback((next: Config) => {
    setConfig(next);
    try {
      saveConfig(next);
    } catch (err) {
      notify(`Gagal menyimpan config: ${String(err)}`, "error");
    }
  }, [notify]);

  const startLoop = useCallback(async () => {
    if (!prompt.trim()) {
      notify("Prompt tugas masih kosong.", "error");
      return;
    }
    if (!draftModel) {
      notify("Pilih model dulu dengan /model.", "error");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const locked = draftModel;
    setLockedModel(locked);
    setIterations([]);
    setResult(null);
    setStatus({ ...INITIAL_STATUS, phase: "running" });
    deadlineRef.current = Date.now() + durationMs;
    loopStartRef.current = Date.now();
    extraTimeRef.current = 0;
    setNow(Date.now());
    setPhase("loop");

    const nextConfig: Config = {
      ...config,
      activeModel: locked,
      durationMs,
      retryDelayMs,
      savedModels: mergeSaved(config.savedModels, locked),
    };
    persist(nextConfig);

    if (!binaryRef.current) binaryRef.current = await findOpencodeBinary();

    const loopResult = await runLoop({
      cwd,
      binary: binaryRef.current,
      prompt,
      lockedModel: locked,
      durationMs,
      config: { ...nextConfig },
      signal: controller.signal,
      getRetryDelayMs: () => retryRef.current,
      getExtraTimeMs: () => extraTimeRef.current,
      onStatus: (s) => setStatus(s),
      onIteration: (record) => setIterations((prev) => [...prev, record]),
    });

    setResult(loopResult);
    setStatus(loopResult.status);
    setPhase("selesai");
  }, [prompt, draftModel, durationMs, retryDelayMs, config, cwd, persist, notify]);

  const handleCommand = useCallback(
    (line: string): boolean => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("/")) return false;
      const [cmd, ...rest] = trimmed.split(/\s+/);
      const arg = rest.join(" ").trim();
      const running = phase === "loop";

      switch (cmd) {
        case "/help":
          setShowHelp(true);
          return true;
        case "/model": {
          if (running) {
            notify("Model terkunci untuk sesi ini. Stop/selesai dulu.", "error");
            return true;
          }
          setOverlay("model");
          return true;
        }
        case "/provider": {
          const sub = rest[0];
          if (sub === "add") {
            setOverlay("provider");
            return true;
          }
          if (sub === "list") {
            const ids = Object.keys(config.providers ?? {});
            notify(
              ids.length ? `Provider: ${ids.join(", ")}` : "Belum ada provider tambahan.",
              "info",
            );
            return true;
          }
          notify("Gunakan /provider add atau /provider list.", "info");
          return true;
        }
        case "/durasi": {
          const ms = parseDuration(arg);
          if (!ms) {
            notify("Format durasi tidak valid (contoh: 2h, 30m, 90s).", "error");
            return true;
          }
          if (running) {
            const elapsed = Date.now() - loopStartRef.current;
            const remaining = Math.max(0, ms - elapsed);
            extraTimeRef.current += remaining - Math.max(0, deadlineRef.current - Date.now());
            deadlineRef.current = Date.now() + remaining;
            notify(`Durasi disesuaikan → ${formatDuration(ms)} total.`, "info");
          } else {
            setDurationMs(ms);
            notify(`Durasi diset ${formatDuration(ms)}.`, "info");
          }
          return true;
        }
        case "/retry": {
          const ms = parseDuration(arg);
          if (!ms) {
            notify("Format retry tidak valid (contoh: 10s).", "error");
            return true;
          }
          setRetryDelayMs(ms);
          notify(`Jeda retry diset ${Math.round(ms / 1000)}s.`, "info");
          return true;
        }
        case "/iterasi": {
          if (iterations.length === 0) {
            notify("Belum ada iterasi.", "info");
            return true;
          }
          notify(
            iterations
              .slice(-5)
              .map(
                (it) =>
                  `#${it.index} ${it.ok ? "OK" : "GAGAL"} ${it.changedFiles ? "berubah" : "tetap"}${
                    it.error ? ` [${it.error.kind}]` : ""
                  }`,
              )
              .join(" | "),
            "info",
          );
          return true;
        }
        case "/stop": {
          if (running) {
            abortRef.current?.abort();
            notify("Menghentikan loop…", "info");
          } else {
            notify("Tidak ada loop yang berjalan.", "info");
          }
          return true;
        }
        default:
          notify(`Perintah tidak dikenal: ${cmd}. Ketik /help.`, "error");
          return true;
      }
    },
    [phase, config, durationMs, iterations, notify],
  );

  const submitLine = useCallback(() => {
    const line = buffer;
    setBuffer("");
    if (handleCommand(line)) return;

    if (phase === "durasi") {
      const ms = parseDuration(line);
      if (!ms) {
        notify("Format durasi tidak valid (contoh: 2h, 30m, 90s).", "error");
        return;
      }
      setDurationMs(ms);
      setPhase("prompt");
      return;
    }

    if (phase === "prompt") {
      if (!line.trim()) {
        notify("Prompt tugas masih kosong.", "error");
        return;
      }
      setPrompt(line.trim());
      setPhase("siap");
      return;
    }

    if (phase === "siap") {
      if (line.trim()) {
        setPrompt(line.trim());
      }
      void startLoop();
      return;
    }

    if (phase === "selesai") {
      if (line.trim()) {
        setPrompt(line.trim());
      }
      void startLoop();
      return;
    }
  }, [buffer, handleCommand, phase, notify, startLoop]);

  const remainingMs =
    phase === "loop"
      ? Math.max(0, deadlineRef.current - now)
      : phase === "selesai" && loopStartRef.current
        ? 0
        : durationMs;
  const elapsedMs = phase === "loop" || phase === "selesai" ? now - loopStartRef.current : 0;
  const activeDisplay = phase === "loop" ? lockedModel : draftModel;

  const help = useMemo(
    () => [
      "/model — pilih model (terkunci saat loop)",
      "/provider add — tambah provider (baseURL + apiKey + model)",
      "/provider list — daftar provider tambahan",
      "/durasi 2h — ubah durasi (saat loop hanya memperpanjang)",
      "/retry 10s — ubah jeda retry",
      "/iterasi — ringkas iterasi terakhir",
      "/stop — hentikan loop",
      "/help — bantuan",
    ],
    [],
  );

  if (showHelp) {
    return (
      <Box flexDirection="column">
        {isRawModeSupported ? <EscClose onClose={() => setShowHelp(false)} /> : null}
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text bold>Perintah</Text>
          {help.map((h) => (
            <Text key={h}> {h}</Text>
          ))}
        </Box>
        <Text dimColor>Tekan sembarang tombol untuk kembali…</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {isRawModeSupported ? (
        <InputHandler
          enabled={overlay === "none" && !showHelp}
          onReturn={submitLine}
          onEscape={() => {
            if (phase === "loop") abortRef.current?.abort();
            else setBuffer("");
          }}
          onBackspace={() => setBuffer((b) => b.slice(0, -1))}
          onCtrlC={() => {
            if (phase === "loop") abortRef.current?.abort();
            else exit();
          }}
          onChar={(ch) => setBuffer((b) => b + ch)}
        />
      ) : null}
      {!isRawModeSupported ? (
        <Text color="red">
          ⚠ Terminal tidak mendukung mode interaktif (raw mode). Jalankan `mecut` langsung di
          terminal/Windows Terminal atau PowerShell asli.
        </Text>
      ) : null}
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">
          mecut v1.0 — Autonomous Coding Loop
        </Text>
        <Text dimColor>
          Folder: {cwd} | Mode sesi: {config.sessionMode} | Retry: {Math.round(retryDelayMs / 1000)}s
          {config.errorBackoffAfter > 0 ? ` | Backoff ≥${config.errorBackoffAfter} err` : ""} |
          Timeout/iterasi: {formatDuration(config.iterationTimeoutMs)}
        </Text>
      </Box>

      {phase !== "durasi" && (
        <StatusBar
          status={status}
          remainingMs={remainingMs}
          elapsedMs={elapsedMs}
          model={activeDisplay}
          locked={phase === "loop"}
          cwd={cwd}
        />
      )}

      {phase === "durasi" && (
        <Box>
          <Text color="yellow">Durasi kerja? </Text>
          <Text dimColor>(contoh: 2h, 30m, 90s): </Text>
          <Text bold>{buffer || ""}</Text>
          <Text dimColor>│</Text>
        </Box>
      )}

      {phase === "prompt" && (
        <Box flexDirection="column">
          <Box>
            <Text color="yellow">Prompt tugas: </Text>
            <Text bold>{buffer || ""}</Text>
            <Text dimColor>│</Text>
          </Box>
          <Text dimColor>
            Model: {draftModel || "(belum dipilih)"} — ketik /model untuk ganti. Durasi:{" "}
            {formatDuration(durationMs)}
          </Text>
        </Box>
      )}

      {phase === "siap" && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text>
            <Text color="yellow">Prompt: </Text>
            {prompt}
          </Text>
          <Text>
            <Text color="yellow">Model (TERKUNCI): </Text>
            {draftModel}
          </Text>
          <Text>
            <Text color="yellow">Durasi: </Text>
            {formatDuration(durationMs)}
          </Text>
          <Text dimColor>[Enter untuk mulai] [ketik prompt baru untuk ganti] /help</Text>
        </Box>
      )}

      {(phase === "loop" || phase === "selesai") && (
        <Box flexDirection="column">
          <Box>
            <Text color="yellow">Prompt: </Text>
            <Text>{prompt}</Text>
          </Box>
          {phase === "loop" ? (
            <Box>
              <Text dimColor>ketik perintah (</Text>
              <Text>/help</Text>
              <Text dimColor>) atau /stop › </Text>
              <Text bold>{buffer}</Text>
              <Text dimColor>│</Text>
            </Box>
          ) : (
            <Box>
              <Text dimColor>ketik prompt baru lalu Enter untuk ulang, atau Ctrl+C keluar › </Text>
              <Text bold>{buffer}</Text>
              <Text dimColor>│</Text>
            </Box>
          )}
        </Box>
      )}

      {phase === "selesai" && result ? <Summary result={result} /> : null}

      {overlay === "model" ? (
        <ModelPicker
          models={models}
          activeModel={draftModel}
          onSelect={(id) => {
            setDraftModel(id);
            setOverlay("none");
            notify(`Model diset: ${id}`, "success");
          }}
          onClose={() => setOverlay("none")}
        />
      ) : null}

      {overlay === "provider" ? (
        <ProviderWizard
          config={config}
          onSaved={async (next) => {
            setConfig(next);
            const merged = await getMergedModels(next);
            setModels(merged);
          }}
          onClose={() => setOverlay("none")}
          notify={notify}
        />
      ) : null}

      {notices.map((n) => (
        <Text
          key={n.id}
          color={n.kind === "error" ? "red" : n.kind === "success" ? "green" : "cyan"}
        >
          {n.kind === "error" ? "⚠ " : n.kind === "success" ? "✓ " : "ℹ "}
          {n.message}
        </Text>
      ))}
    </Box>
  );
}

function EscClose({ onClose }: { onClose: () => void }) {
  useInput(() => onClose());
  return null;
}

interface InputHandlerProps {
  enabled: boolean;
  onReturn: () => void;
  onEscape: () => void;
  onBackspace: () => void;
  onCtrlC: () => void;
  onChar: (ch: string) => void;
}

function InputHandler({
  enabled,
  onReturn,
  onEscape,
  onBackspace,
  onCtrlC,
  onChar,
}: InputHandlerProps) {
  useInput(
    (input, key) => {
      if (key.return) {
        onReturn();
        return;
      }
      if (key.escape) {
        onEscape();
        return;
      }
      if (key.backspace || key.delete) {
        onBackspace();
        return;
      }
      if (key.ctrl && input === "c") {
        onCtrlC();
        return;
      }
      if (key.tab) return;
      if (input && !key.ctrl && !key.meta && !/[\r\n\t]/.test(input)) {
        onChar(input);
      }
    },
    { isActive: enabled },
  );
  return null;
}

function mergeSaved(saved: SavedModel[], id: string): SavedModel[] {
  const { provider, model } = splitModelId(id);
  if (!provider) return saved;
  if (saved.some((s) => s.provider === provider && s.model === model)) return saved;
  return [...saved, { provider, model, label: model }];
}

function formatLine(it: IterationRecord): string {
  return `#${it.index} ${it.ok ? "OK" : "GAGAL"} ${formatTokens(it.tokens)} tok ${formatMoney(it.cost)}`;
}

void formatLine;
