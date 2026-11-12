import { execa } from "execa";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWrite, backupFile } from "../utils.js";

export const OPENCODE_CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "opencode",
  "opencode.json",
);

let cachedBinary: string | null = null;

function resolveNativeExe(shimPath: string): string | null {
  const dir = path.dirname(shimPath);
  const candidate = path.join(dir, "node_modules", "opencode-ai", "bin", "opencode.exe");
  if (fs.existsSync(candidate)) return candidate;
  const unixCandidate = path.join(dir, "node_modules", "opencode-ai", "bin", "opencode");
  if (fs.existsSync(unixCandidate) && process.platform !== "win32") return unixCandidate;
  return null;
}

export async function findOpencodeBinary(): Promise<string> {
  if (cachedBinary) return cachedBinary;
  try {
    const { stdout } = await execa(process.platform === "win32" ? "where" : "which", ["opencode"], {
      reject: false,
    });
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const exeDirect = lines.find((l) => /\.exe$/i.test(l));
    if (exeDirect) {
      cachedBinary = exeDirect;
      return exeDirect;
    }
    const shim = lines.find((l) => /\.(cmd|bat|ps1)$/i.test(l)) ?? lines[0];
    if (shim) {
      const native = resolveNativeExe(shim);
      cachedBinary = native ?? shim;
      return cachedBinary;
    }
  } catch {
    // fall through
  }
  const fallbackShim = path.join(
    process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
    "npm",
    "opencode.cmd",
  );
  cachedBinary = resolveNativeExe(fallbackShim) ?? fallbackShim;
  return cachedBinary;
}

export interface ModelInfo {
  id: string;
  provider: string;
  model: string;
  label: string;
}

let cachedModels: ModelInfo[] | null = null;

export async function listOpencodeModels(refresh = false): Promise<ModelInfo[]> {
  if (cachedModels && !refresh) return cachedModels;
  const binary = await findOpencodeBinary();
  try {
    const { stdout } = await execa(binary, ["models"], { reject: false, timeout: 30_000 });
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.includes(" "));
    const models: ModelInfo[] = [];
    for (const line of lines) {
      const slash = line.indexOf("/");
      if (slash === -1) continue;
      const provider = line.slice(0, slash);
      const model = line.slice(slash + 1);
      models.push({ id: line, provider, model, label: line });
    }
    if (models.length > 0) cachedModels = models;
    return models;
  } catch {
    return cachedModels ?? [];
  }
}

export interface ProviderInput {
  id: string;
  npm?: string;
  name?: string;
  baseURL: string;
  apiKey?: string;
  models: string[];
}

export interface InjectResult {
  ok: boolean;
  backup?: string | null;
  error?: string;
}

export async function injectProviderIntoOpencode(input: ProviderInput): Promise<InjectResult> {
  const modelsMap: Record<string, { name: string }> = {};
  for (const m of input.models) {
    if (!m.trim()) continue;
    modelsMap[m.trim()] = { name: m.trim() };
  }
  const providerEntry = {
    npm: input.npm?.trim() || "@ai-sdk/openai-compatible",
    name: input.name?.trim() || input.id,
    options: {
      baseURL: input.baseURL.trim(),
      ...(input.apiKey?.trim() ? { apiKey: input.apiKey.trim() } : {}),
    },
    models: modelsMap,
  };

  let backup: string | null = null;
  let original: string | null = null;
  let current: any = { $schema: "https://opencode.ai/config.json" };

  if (fs.existsSync(OPENCODE_CONFIG_PATH)) {
    original = fs.readFileSync(OPENCODE_CONFIG_PATH, "utf8");
    try {
      current = JSON.parse(original);
    } catch (err) {
      return { ok: false, error: `Config opencode.json tidak valid: ${String(err)}` };
    }
  }

  current.provider = current.provider ?? {};
  current.provider[input.id] = providerEntry;

  const next = JSON.stringify(current, null, 2) + "\n";
  try {
    JSON.parse(next);
  } catch (err) {
    return { ok: false, error: `Gagal membuat JSON baru: ${String(err)}` };
  }

  try {
    backup = backupFile(OPENCODE_CONFIG_PATH);
    atomicWrite(OPENCODE_CONFIG_PATH, next);
  } catch (err) {
    if (original !== null) {
      try {
        atomicWrite(OPENCODE_CONFIG_PATH, original);
      } catch {
        // ignore
      }
    }
    return { ok: false, backup, error: `Gagal menulis config: ${String(err)}` };
  }

  cachedModels = null;
  return { ok: true, backup };
}
