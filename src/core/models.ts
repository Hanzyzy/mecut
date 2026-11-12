import os from "node:os";
import type { Config } from "../config.js";
import { listOpencodeModels, type ModelInfo } from "./opencode.js";

export interface MergedModel extends ModelInfo {
  source: "saved" | "opencode" | "provider";
}

export async function getMergedModels(config: Config): Promise<MergedModel[]> {
  const map = new Map<string, MergedModel>();

  const opencodeModels = await listOpencodeModels();
  for (const m of opencodeModels) {
    map.set(m.id, { ...m, source: "opencode" });
  }

  for (const [providerId, provider] of Object.entries(config.providers ?? {})) {
    for (const modelName of Object.keys((provider as any).models ?? {})) {
      const id = `${providerId}/${modelName}`;
      if (!map.has(id)) {
        map.set(id, {
          id,
          provider: providerId,
          model: modelName,
          label: `${modelName} (${providerId})`,
          source: "provider",
        });
      }
    }
  }

  for (const saved of config.savedModels) {
    const id = `${saved.provider}/${saved.model}`;
    const existing = map.get(id);
    map.set(id, {
      id,
      provider: saved.provider,
      model: saved.model,
      label: saved.label ?? existing?.label ?? id,
      source: "saved",
    });
  }

  const arr = Array.from(map.values());
  const weight: Record<MergedModel["source"], number> = { saved: 0, provider: 1, opencode: 2 };
  arr.sort((a, b) => a.source.localeCompare(b.source) && a.id.localeCompare(b.id));
  arr.sort((a, b) => weight[a.source] - weight[b.source] || a.id.localeCompare(b.id));
  return arr;
}

export function splitModelId(id: string): { provider: string; model: string } {
  const slash = id.indexOf("/");
  if (slash === -1) return { provider: "", model: id };
  return { provider: id.slice(0, slash), model: id.slice(slash + 1) };
}

export function homeDir(): string {
  return os.homedir();
}
