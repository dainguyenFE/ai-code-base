#!/usr/bin/env bun
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveProjectConfig } from "../core/src/project-config.ts";

const UI_PORT = 4444;

const printHelp = (): void => {
  process.stdout.write(
    `page-logic-visualizer — inspect Next.js page logic and data flow

Usage:
  page-logic-visualizer dev [options]   Start the visualizer UI (default)
  page-logic-visualizer --help          Show this help

Options:
  --port <number>    UI dev server port (default: ${UI_PORT})
  --root <path>      Project root to analyze (default: cwd / config)
  --config <path>    Path to page-logic-visualizer.config.*

The CLI looks for page-logic-visualizer.config.ts in the current directory
(or parents) to detect monorepo vs standalone Next.js project layout.
`
  );
};

const parseArgs = (argv: string[]) => {
  let command = "dev";
  let port = UI_PORT;
  let root: string | undefined;
  let config: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      return { command: "help" as const, config, port, root };
    }
    if (arg === "--port") {
      port = Number(argv[++i]);
      continue;
    }
    if (arg === "--root") {
      root = argv[++i];
      continue;
    }
    if (arg === "--config") {
      config = argv[++i];
      continue;
    }
    if (!arg.startsWith("-") && command === "dev" && arg !== "dev") {
      command = arg;
    }
    if (arg === "dev") {
      command = "dev";
    }
  }

  return { command, config, port, root };
};

const packageRoot = path.resolve(import.meta.dirname, "..");

const main = async (): Promise<void> => {
  const { command, port, root, config } = parseArgs(process.argv.slice(2));

  if (command === "help") {
    printHelp();
    return;
  }

  const projectConfig = await resolveProjectConfig({
    configPath: config,
    rootDir: root,
    startDir: root ?? process.cwd(),
  });

  const sep = "─".repeat(52);
  process.stdout.write(
    `\n  Page Logic Visualizer\n  ${sep}\n` +
      `  UI:      http://localhost:${port}\n` +
      `  Root:    ${projectConfig.rootDir}\n` +
      `  Layout:  ${projectConfig.projectType}\n${
        projectConfig.configFilePath
          ? `  Config:  ${projectConfig.configFilePath}\n`
          : ""
      }  ${sep}\n\n`
  );

  const proc = Bun.spawn(["bunx", "next", "dev", "-p", String(port)], {
    cwd: packageRoot,
    env: {
      ...process.env,
      PAGE_LOGIC_VISUALIZER_ROOT: projectConfig.rootDir,
    },
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });

  const code = await proc.exited;
  process.exit(code);
};

await main();
