import React from "react";
import { Box, Text } from "ink";
import { formatDuration, formatMoney, formatTokens } from "../utils.js";
import type { LoopStatus } from "../core/loop.js";

interface Props {
  status: LoopStatus;
  remainingMs: number;
  elapsedMs: number;
  model: string;
  locked: boolean;
  cwd: string;
}

export function StatusBar({ status, remainingMs, elapsedMs, model, locked, cwd }: Props) {
  const phaseLabel =
    status.phase === "running"
      ? "bekerja"
      : status.phase === "waiting"
        ? "menunggu"
        : status.phase === "done"
          ? "selesai"
          : "idle";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box>
        <Text color="cyan" bold>
          ⏱ {formatDuration(remainingMs)}
        </Text>
        <Text dimColor> sisa</Text>
        <Text dimColor> | berlalu </Text>
        <Text>{formatDuration(elapsedMs)}</Text>
        <Text dimColor> | </Text>
        <Text>iterasi </Text>
        <Text bold>#{status.iteration}</Text>
        <Text dimColor> | </Text>
        <Text color="green">OK {status.okCount}</Text>
        <Text dimColor>, </Text>
        <Text color="red">gagal {status.failCount}</Text>
        <Text dimColor> (beruntun {status.consecutiveErrors})</Text>
      </Box>
      <Box>
        <Text dimColor>model: </Text>
        <Text color="magenta">{model || "(belum dipilih)"}</Text>
        {locked ? <Text color="yellow"> 🔒 terkunci</Text> : null}
        <Text dimColor> | sesi: </Text>
        <Text dimColor>{status.sessionId ?? "-"}</Text>
      </Box>
      <Box>
        <Text dimColor>tokens: {formatTokens(status.totalTokens)}</Text>
        <Text dimColor> | biaya: {formatMoney(status.totalCost)}</Text>
        <Text dimColor> | </Text>
        <Text color="cyan">{phaseLabel}</Text>
        {status.currentDelayMs > 0 ? (
          <Text dimColor> (jeda {Math.round(status.currentDelayMs / 1000)}s)</Text>
        ) : null}
      </Box>
      <Box>
        <Text dimColor>📁 {cwd}</Text>
      </Box>
      {status.lastError ? (
        <Box>
          <Text color="red">
            ⚠ error terakhir [{status.lastError.kind}]: {status.lastError.message.slice(0, 120)}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
