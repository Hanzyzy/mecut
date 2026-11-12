import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { MergedModel } from "../core/models.js";

interface Props {
  models: MergedModel[];
  activeModel: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function ModelPicker({ models, activeModel, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const filtered = models.filter((m) => m.id.toLowerCase().includes(query.toLowerCase()));
  const safeCursor = Math.min(cursor, Math.max(0, filtered.length - 1));

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.return) {
      const chosen = filtered[safeCursor];
      if (chosen) onSelect(chosen.id);
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setCursor(0);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setCursor(0);
    }
  });

  const windowSize = 12;
  const start = Math.max(0, Math.min(safeCursor - Math.floor(windowSize / 2), filtered.length - windowSize));
  const visible = filtered.slice(start, start + windowSize);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Box>
        <Text bold color="magenta">
          Pilih model
        </Text>
        <Text dimColor>  (ketik untuk mencari, ↑↓ pilih, Enter konfirmasi, Esc batal)</Text>
      </Box>
      <Box>
        <Text dimColor>cari: </Text>
        <Text>{query || "…"}</Text>
      </Box>
      {filtered.length === 0 ? (
        <Text color="red">Tidak ada model yang cocok.</Text>
      ) : (
        visible.map((m, i) => {
          const idx = start + i;
          const isCursor = idx === safeCursor;
          const isActive = m.id === activeModel;
          return (
            <Box key={m.id}>
              <Text color={isCursor ? "cyan" : undefined} inverse={isCursor}>
                {isCursor ? "❯ " : "  "}
                {m.id}
              </Text>
              {isActive ? <Text color="green"> ✓ aktif</Text> : null}
              <Text dimColor> [{m.source}]</Text>
            </Box>
          );
        })
      )}
      <Text dimColor>
        {filtered.length} model tersedia
      </Text>
    </Box>
  );
}
