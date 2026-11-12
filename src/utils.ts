import fs from "node:fs";
import path from "node:path";

export function parseDuration(input: string): number | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min|h|hr|d)?$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2] ?? "m";
  const factors: Record<string, number> = {
    ms: 1,
    s: 1000,
    sec: 1000,
    m: 60_000,
    min: 60_000,
    h: 3_600_000,
    hr: 3_600_000,
    d: 86_400_000,
  };
  return Math.round(value * factors[unit]);
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function formatMoney(usd: number): string {
  if (!usd) return "$0.0000";
  return `$${usd.toFixed(usd < 0.01 ? 5 : 4)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

export function backupFile(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "-");
  const backup = `${file}.bak-mecut-${stamp}`;
  fs.copyFileSync(file, backup);
  return backup;
}

export type ErrorKind =
  | "rate_limit"
  | "upstream"
  | "timeout"
  | "connection"
  | "context_full"
  | "auth"
  | "model"
  | "tool"
  | "unknown";

export interface ClassifiedError {
  kind: ErrorKind;
  message: string;
  retriable: boolean;
}

const PATTERNS: Array<{ kind: ErrorKind; re: RegExp; retriable: boolean }> = [
  { kind: "rate_limit", re: /(rate limit|429|too many requests|quota exceeded)/i, retriable: true },
  { kind: "upstream", re: /(upstream|bad gateway|502|503|504|520|521|522|523|524|provider error|temporarily unavailable)/i, retriable: true },
  { kind: "context_full", re: /(context (window|length)|context_length_exceeded|too many tokens|maximum context)/i, retriable: true },
  { kind: "auth", re: /(unauthorized|401|403|invalid api key|authentication|permission denied)/i, retriable: false },
  { kind: "model", re: /(model not found|404|does not exist|unknown model|no such model|model.*unavailable)/i, retriable: false },
  { kind: "timeout", re: /(timed? ?out|timeout)/i, retriable: true },
  { kind: "connection", re: /(econnrefused|econnreset|enotfound|network|socket hang up|fetch failed|connection)/i, retriable: true },
  { kind: "tool", re: /(tool.*(failed|error)|command failed)/i, retriable: true },
];

export function classifyError(message: string): ClassifiedError {
  for (const p of PATTERNS) {
    if (p.re.test(message)) {
      return { kind: p.kind, message: message.trim(), retriable: p.retriable };
    }
  }
  return { kind: "unknown", message: message.trim(), retriable: true };
}
