import React from "react";
import { Box, Text } from "ink";
import { formatDuration, formatMoney, formatTokens } from "../utils.js";
import type { IterationRecord, LoopResult } from "../core/loop.js";

interface Props {
  result: LoopResult;
}

export function Summary({ result }: Props) {
  const { status, iterations, startedAt, endedAt, stoppedBy } = result;
  const elapsed = endedAt - startedAt;
  const reason =
    stoppedBy === "timer"
      ? "waktu habis"
      : stoppedBy === "abort"
        ? "dihentikan pengguna"
        : "batas error beruntun tercapai";

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="green" paddingX={1}>
      <Text bold color="green">
        Ringkasan sesi — berhenti karena {reason}
      </Text>
      <Box>
        <Text dimColor>durasi berjalan: </Text>
        <Text>{formatDuration(elapsed)}</Text>
        <Text dimColor> | total iterasi: </Text>
        <Text>{iterations.length}</Text>
      </Box>
      <Box>
        <Text color="green">OK {status.okCount}</Text>
        <Text dimColor>, </Text>
        <Text color="red">gagal {status.failCount}</Text>
        <Text dimColor> | token: {formatTokens(status.totalTokens)}</Text>
        <Text dimColor> | biaya: {formatMoney(status.totalCost)}</Text>
      </Box>
      <Box>
        <Text dimColor>sesi: {status.sessionId ?? "-"}</Text>
      </Box>
      {iterations.slice(-8).map((it: IterationRecord) => (
        <Box key={it.index}>
          <Text dimColor>#{String(it.index).padStart(3, " ")} </Text>
          {it.ok ? (
            <Text color="green">OK</Text>
          ) : (
            <Text color="red">GAGAL</Text>
          )}
          <Text dimColor>
            {" "}
            {it.changedFiles ? "berubah" : "tanpa perubahan"} · {formatTokens(it.tokens)} tok ·{" "}
            {formatMoney(it.cost)}
            {it.error ? ` · ${it.error.kind}` : ""}
          </Text>
        </Box>
      ))}
      {iterations.length > 8 ? <Text dimColor>… dan {iterations.length - 8} iterasi lainnya</Text> : null}
    </Box>
  );
}
