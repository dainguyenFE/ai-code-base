#!/usr/bin/env bun
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runIndex } from "./commands/index-project.js";
import { runExport } from "./commands/export-context.js";
import { runTrace } from "./commands/trace.js";
import { runCursorInit } from "./commands/cursor-init.js";

const program = new Command();

program
  .name("ai-trace")
  .description("Local AI code trace agent")
  .version("0.0.1");

program
  .command("init")
  .description("Create .ai-trace/config.json")
  .action(async () => {
    await runInit(process.cwd());
  });

program
  .command("index")
  .description("Scan, parse, build graph and save to SQLite")
  .action(async () => {
    await runIndex(process.cwd());
  });

program
  .command("export")
  .description("Export markdown/json context files")
  .action(async () => {
    await runExport(process.cwd());
  });

program
  .command("trace")
  .description("Trace component, route or hook from local index")
  .argument("<type>", "component | route | hook")
  .argument("<name>", "symbol name or route path")
  .action(async (type: string, name: string) => {
    await runTrace(process.cwd(), type, name);
  });

const cursor = program
  .command("cursor")
  .description("Cursor IDE integration");

cursor
  .command("init")
  .description("Generate .cursor/rules for AI trace context")
  .action(async () => {
    await runCursorInit(process.cwd());
  });

program.parse();
