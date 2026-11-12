import React from "react";
import { render } from "ink";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { App } from "./app.js";
import { parseDuration } from "./utils.js";

const program = new Command();

program
  .name("mecut")
  .version("1.0.0", "-v, --version", "tampilkan versi")
  .description("Autonomous coding loop — kirim prompt yang sama ke AI sampai durasi habis")
  .option("--durasi <waktu>", "durasi kerja (mis. 2h, 30m, 90s)")
  .option("--model <provider/model>", "model yang dipakai (terkunci saat mulai)")
  .option("--retry <waktu>", "jeda antar-retry (mis. 5s, 10s)")
  .action(async (opts) => {
    const cwd = process.cwd();
    const config = loadConfig();

    let durationMs: number | undefined;
    if (opts.durasi) {
      const parsed = parseDuration(String(opts.durasi));
      if (!parsed) {
        console.error(`Durasi tidak valid: ${opts.durasi}`);
        process.exit(1);
      }
      durationMs = parsed;
    }

    let retryMs: number | undefined;
    if (opts.retry) {
      const parsed = parseDuration(String(opts.retry));
      if (!parsed) {
        console.error(`Retry tidak valid: ${opts.retry}`);
        process.exit(1);
      }
      retryMs = parsed;
    }

    const { waitUntilExit } = render(
      <App initialConfig={config} cwd={cwd} flags={{ durationMs, model: opts.model, retryMs }} />,
    );
    await waitUntilExit();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
