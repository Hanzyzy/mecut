import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { injectProviderIntoOpencode, type ProviderInput } from "../core/opencode.js";
import { saveConfig, type Config } from "../config.js";

interface Props {
  config: Config;
  onSaved: (config: Config) => void;
  onClose: () => void;
  notify: (msg: string, kind?: "info" | "error" | "success") => void;
}

type Field = "id" | "name" | "baseURL" | "apiKey" | "models";

export function ProviderWizard({ config, onSaved, onClose, notify }: Props) {
  const [values, setValues] = useState<Record<Field, string>>({
    id: "",
    name: "",
    baseURL: "",
    apiKey: "",
    models: "",
  });
  const [field, setField] = useState<Field>("id");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const order: Field[] = ["id", "name", "baseURL", "apiKey", "models"];
  const labels: Record<Field, string> = {
    id: "ID provider (mis. myprovider)",
    name: "Nama tampilan",
    baseURL: "Base URL (mis. https://api.example.com/v1)",
    apiKey: "API key (boleh kosong)",
    models: "Daftar model, pisah koma (mis. gpt-4o, gpt-4o-mini)",
  };

  const submit = async () => {
    if (!values.id.trim() || !values.baseURL.trim()) {
      setError("ID provider dan Base URL wajib diisi.");
      return;
    }
    const models = values.models
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);

    const input: ProviderInput = {
      id: values.id.trim(),
      name: values.name.trim() || values.id.trim(),
      baseURL: values.baseURL.trim(),
      apiKey: values.apiKey.trim() || undefined,
      models,
    };

    const inject = await injectProviderIntoOpencode(input);
    if (!inject.ok) {
      setError(`Gagal menulis ke opencode.json: ${inject.error}`);
      return;
    }

    const modelsMap: Record<string, { name: string }> = {};
    for (const m of models) modelsMap[m] = { name: m };

    const nextConfig: Config = {
      ...config,
      providers: {
        ...config.providers,
        [input.id]: {
          npm: input.npm ?? "@ai-sdk/openai-compatible",
          name: input.name,
          options: {
            baseURL: input.baseURL,
            ...(input.apiKey ? { apiKey: input.apiKey } : {}),
          },
          models: modelsMap,
        },
      },
    };
    saveConfig(nextConfig);
    onSaved(nextConfig);
    setDone(true);
    notify(
      `Provider "${input.id}" ditambahkan (${models.length} model). Backup: ${inject.backup ?? "-"}`,
      "success",
    );
    setTimeout(onClose, 1200);
  };

  useInput((input, key) => {
    if (done) return;
    if (key.escape) {
      onClose();
      return;
    }
    if (key.return) {
      const idx = order.indexOf(field);
      if (field === "models") {
        void submit();
      } else if (idx < order.length - 1) {
        setField(order[idx + 1]);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setValues((v) => ({ ...v, [field]: v[field].slice(0, -1) }));
      return;
    }
    if (key.tab) {
      const idx = order.indexOf(field);
      const next = key.shift ? (idx - 1 + order.length) % order.length : (idx + 1) % order.length;
      setField(order[next]);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setValues((v) => ({ ...v, [field]: v[field] + input }));
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
      <Box>
        <Text bold color="green">
          Tambah provider
        </Text>
        <Text dimColor>  (Tab/Enter lanjut field, Enter di field terakhir = simpan, Esc batal)</Text>
      </Box>
      {order.map((f) => (
        <Box key={f}>
          <Text color={field === f ? "cyan" : undefined} inverse={field === f}>
            {field === f ? "❯ " : "  "}
            {labels[f]}:{" "}
          </Text>
          <Text>{values[f]}</Text>
        </Box>
      ))}
      {error ? <Text color="red">⚠ {error}</Text> : null}
      {done ? <Text color="green">✓ Provider disimpan.</Text> : null}
    </Box>
  );
}
