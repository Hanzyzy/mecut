import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { Config } from "../config.js";
import { delay, type ClassifiedError } from "../utils.js";
import { runOnce, type RunnerEvent } from "./runner.js";

export interface IterationRecord {
  index: number;
  startedAt: number;
  endedAt: number;
  ok: boolean;
  changedFiles: boolean;
  tokens: number;
  cost: number;
  error?: ClassifiedError;
  textPreview: string;
}

export interface LoopStatus {
  iteration: number;
  okCount: number;
  failCount: number;
  consecutiveErrors: number;
  totalTokens: number;
  totalCost: number;
  sessionId: string | null;
  currentDelayMs: number;
  lastError?: ClassifiedError;
  phase: "idle" | "running" | "waiting" | "done";
}

export interface LoopOptions {
  cwd: string;
  binary: string;
  prompt: string;
  lockedModel: string;
  durationMs: number;
  config: Config;
  signal: AbortSignal;
  getRetryDelayMs: () => number;
  getExtraTimeMs: () => number;
  onStatus: (status: LoopStatus) => void;
  onIteration: (record: IterationRecord) => void;
  onRunnerEvent?: (event: RunnerEvent) => void;
}

export interface LoopResult {
  status: LoopStatus;
  iterations: IterationRecord[];
  stoppedBy: "timer" | "abort" | "error-stop";
  startedAt: number;
  endedAt: number;
}

async function snapshot(cwd: string): Promise<string> {
  const git = await execa("git", ["status", "--porcelain"], { cwd, reject: false });
  if (git.exitCode === 0) return git.stdout;
  try {
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    return entries.map((e) => `${e.name}:${e.isDirectory() ? "d" : "f"}`).join("\n");
  } catch {
    return "";
  }
}

export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
  const startedAt = Date.now();
  const iterations: IterationRecord[] = [];
  let sessionId: string | null = null;

  const status: LoopStatus = {
    iteration: 0,
    okCount: 0,
    failCount: 0,
    consecutiveErrors: 0,
    totalTokens: 0,
    totalCost: 0,
    sessionId: null,
    currentDelayMs: 0,
    phase: "running",
  };

  const baseDeadline = startedAt + opts.durationMs;
  const deadline = () => baseDeadline + opts.getExtraTimeMs();

  const emit = () => opts.onStatus({ ...status });

  while (Date.now() < deadline()) {
    if (opts.signal.aborted) {
      status.phase = "done";
      emit();
      return { status, iterations, stoppedBy: "abort", startedAt, endedAt: Date.now() };
    }

    status.iteration += 1;
    status.phase = "running";
    emit();

    const iterStart = Date.now();
    const before = await snapshot(opts.cwd);

    let runnerEvent: RunnerEvent | undefined;
    const handle = runOnce(opts.binary, {
      cwd: opts.cwd,
      model: opts.lockedModel,
      prompt: opts.prompt,
      sessionId: opts.config.sessionMode === "same" ? sessionId : null,
      timeoutMs: opts.config.iterationTimeoutMs,
      signal: opts.signal,
      onEvent: (event) => {
        runnerEvent = event;
        if (event.type === "session") {
          sessionId = event.sessionId;
          status.sessionId = event.sessionId;
          emit();
        }
        opts.onRunnerEvent?.(event);
      },
    });
    void runnerEvent;

    const result = await handle.result;
    const iterEnd = Date.now();

    if (result.sessionId && !sessionId) {
      sessionId = result.sessionId;
      status.sessionId = result.sessionId;
    }

    if (opts.signal.aborted) {
      status.phase = "done";
      emit();
      return { status, iterations, stoppedBy: "abort", startedAt, endedAt: Date.now() };
    }

    status.totalTokens += result.tokens;
    status.totalCost += result.cost;

    const after = await snapshot(opts.cwd);
    const changedFiles = before !== after;

    const record: IterationRecord = {
      index: status.iteration,
      startedAt: iterStart,
      endedAt: iterEnd,
      ok: result.ok,
      changedFiles,
      tokens: result.tokens,
      cost: result.cost,
      error: result.error,
      textPreview: result.text.slice(0, 200),
    };
    iterations.push(record);
    opts.onIteration(record);

    if (result.ok) {
      status.okCount += 1;
      status.consecutiveErrors = 0;
      status.lastError = undefined;
    } else {
      status.failCount += 1;
      status.consecutiveErrors += 1;
      status.lastError = result.error;
    }
    emit();

    if (Date.now() >= deadline()) break;

    if (!result.ok) {
      const cfg = opts.config;
      let waitMs = opts.getRetryDelayMs();
      if (cfg.errorBackoffAfter > 0 && status.consecutiveErrors >= cfg.errorBackoffAfter) {
        const exp = status.consecutiveErrors - cfg.errorBackoffAfter;
        waitMs = Math.min(cfg.maxBackoffMs, opts.getRetryDelayMs() * Math.pow(2, exp + 1));
      }
      if (cfg.errorStopAfter > 0 && status.consecutiveErrors >= cfg.errorStopAfter) {
        status.phase = "done";
        emit();
        return { status, iterations, stoppedBy: "error-stop", startedAt, endedAt: Date.now() };
      }
      status.phase = "waiting";
      status.currentDelayMs = waitMs;
      emit();
      try {
        await delay(waitMs, opts.signal);
      } catch {
        status.phase = "done";
        emit();
        return { status, iterations, stoppedBy: "abort", startedAt, endedAt: Date.now() };
      }
      status.currentDelayMs = 0;
    }
  }

  status.phase = "done";
  emit();
  return { status, iterations, stoppedBy: "timer", startedAt, endedAt: Date.now() };
}

export function relPath(cwd: string, p: string): string {
  return path.relative(cwd, p) || p;
}
