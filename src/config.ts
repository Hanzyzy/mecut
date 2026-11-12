import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { atomicWrite } from "./utils.js";

const ProviderSchema = z
  .object({
    npm: z.string().default("@ai-sdk/openai-compatible"),
    name: z.string().optional(),
    options: z.record(z.any()).default({}),
    models: z.record(z.any()).default({}),
  })
  .passthrough();

const SavedModelSchema = z.object({
  provider: z.string(),
  model: z.string(),
  label: z.string().optional(),
});

export const ConfigSchema = z.object({
  version: z.number().default(1),
  activeModel: z.string().default(""),
  durationMs: z.number().positive().default(7_200_000),
  retryDelayMs: z.number().nonnegative().default(5_000),
  errorBackoffAfter: z.number().int().nonnegative().default(3),
  maxBackoffMs: z.number().positive().default(300_000),
  errorStopAfter: z.number().int().nonnegative().default(0),
  iterationTimeoutMs: z.number().positive().default(1_800_000),
  sessionMode: z.enum(["same", "new"]).default("same"),
  savedModels: z.array(SavedModelSchema).default([]),
  providers: z.record(ProviderSchema).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type SavedModel = z.infer<typeof SavedModelSchema>;

export const MECUT_DIR = path.join(os.homedir(), ".mecut");
export const CONFIG_PATH = path.join(MECUT_DIR, "config.json");

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    return ConfigSchema.parse({});
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const parsed = ConfigSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    return ConfigSchema.parse({});
  } catch {
    return ConfigSchema.parse({});
  }
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(MECUT_DIR, { recursive: true });
  atomicWrite(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}
