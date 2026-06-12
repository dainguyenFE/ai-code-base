#!/usr/bin/env bun
import { Command } from "commander";

import { runAsk } from "./commands/ask.js";
import { runClean } from "./commands/clean.js";
import { runCursorInit } from "./commands/cursor-init.js";
import { runExport } from "./commands/export-context.js";
import { runIndex } from "./commands/index-project.js";
import { runInit } from "./commands/init.js";
import { runReindex } from "./commands/reindex.js";
import { runStudio } from "./commands/studio.js";
import { runTrace } from "./commands/trace.js";
import { resolveTraceRoot } from "./resolveTraceRoot.js";

const program = new Command();

program
  .name("ai-trace")
  .description("Local AI code trace agent")
  .version("0.0.1");

program
  .command("init")
  .description("Create .ai-trace/config.json")
  .action(async () => {
    await runInit(resolveTraceRoot());
  });

program
  .command("index")
  .description("Scan, parse, build graph and save to SQLite")
  .action(async () => {
    await runIndex(resolveTraceRoot());
  });

program
  .command("reindex")
  .description(
    "Build trace packages (if needed), clear SQLite cache, and run a full index"
  )
  .option("--no-build", "Skip package build step")
  .option("--no-clean", "Keep existing SQLite cache (incremental parse only)")
  .option("--force-build", "Always rebuild packages before indexing")
  .action(
    async (options: {
      forceBuild?: boolean;
      noBuild?: boolean;
      noClean?: boolean;
    }) => {
      await runReindex(resolveTraceRoot(), {
        build: !options.noBuild,
        clean: !options.noClean,
        forceBuild: options.forceBuild,
      });
    }
  );

program
  .command("export")
  .description("Export markdown/json context files")
  .action(async () => {
    await runExport(resolveTraceRoot());
  });

program
  .command("clean")
  .description("Remove cached index, exports, or all generated trace artifacts")
  .option("--cache", "Remove SQLite index and cache directory")
  .option("--exports", "Remove exported context files")
  .option("--all", "Remove cache, exports, and trace results")
  .action(
    async (options: { all?: boolean; cache?: boolean; exports?: boolean }) => {
      await runClean(resolveTraceRoot(), options);
    }
  );

program
  .command("trace")
  .description("Trace component, route or hook from local index")
  .argument("<type>", "component | route | hook")
  .argument("<name>", "symbol name or route path")
  .option("--ai", "Use AI to explain trace from indexed context")
  .option(
    "--file <path>",
    "Disambiguate duplicate symbol name by source file path"
  )
  .action(
    async (
      type: string,
      name: string,
      options: { ai?: boolean; file?: string }
    ) => {
      await runTrace(resolveTraceRoot(), type, name, {
        ai: options.ai,
        file: options.file,
      });
    }
  );

program
  .command("ask")
  .description("Ask a natural-language trace question using AI + local index")
  .argument("<query>", 'e.g. "trace component BlogDetail"')
  .action(async (query: string) => {
    await runAsk(resolveTraceRoot(), query);
  });

program
  .command("studio")
  .description("Start Trace Studio UI for the indexed workspace")
  .option("--scope <name>", "Trace scope (default: default)")
  .option("--port <number>", "Dev server port", "3456")
  .option(
    "--refresh",
    "Rebuild packages, clear SQLite cache, and re-index before starting"
  )
  .action(
    async (options: { port?: string; refresh?: boolean; scope?: string }) => {
      await runStudio(resolveTraceRoot(), {
        port: options.port ? Number(options.port) : 3456,
        refresh: options.refresh,
        scope: options.scope,
      });
    }
  );

const cursor = program.command("cursor").description("Cursor IDE integration");

cursor
  .command("init")
  .description("Generate .cursor/rules for AI trace context")
  .action(async () => {
    await runCursorInit(resolveTraceRoot());
  });

program.parse();
