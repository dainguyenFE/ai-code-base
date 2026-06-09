# AI Code Trace Agent

Local CLI tool to scan, parse, and trace TypeScript/React/Next.js codebases.

## Stack

- TypeScript + **Bun**
- Bun workspaces (no Turborepo)
- ts-morph (AST parser)
- **bun:sqlite** (local cache)
- commander (CLI)

## Quick start

```bash
# Install dependencies
bun install

# Build all packages (optional — dev can run TS directly)
bun run build

# Go to a project to trace (demo app included)
cd examples/demo-app

# Init config
bun ../../apps/cli/src/index.ts init

# Index codebase
bun ../../apps/cli/src/index.ts index

# Export context for AI/Cursor
bun ../../apps/cli/src/index.ts export

# Trace a component
bun ../../apps/cli/src/index.ts trace component BlogDetail

# Trace a route
bun ../../apps/cli/src/index.ts trace route "/[locale]/blogs/[slug]"

# Generate Cursor rules
bun ../../apps/cli/src/index.ts cursor init
```

From repo root:

```bash
bun run ai-trace init
bun run ai-trace index
bun run ai-trace export
```

## Project structure

```txt
apps/cli/              CLI entry point
packages/
  trace-types/         Shared types
  trace-config/        Config load/validate
  trace-scanner/       File scanner (fast-glob)
  trace-parser/        AST parser (ts-morph)
  trace-graph/         Graph builder + route detection
  trace-cache/         SQLite storage (bun:sqlite)
  trace-exporter/      Markdown/JSON export
  trace-agent/         Trace query engine
examples/demo-app/     Sample app for testing
```

## Output

After `index` + `export`:

```txt
.ai-trace/
  config.json
  cache/index.sqlite
  exports/
    ai-context.md
    component-map.md
    hook-map.md
    route-map.md
    graph.json
    symbols.json
    routes.json
```

## MVP commands

| Command | Description |
|---------|-------------|
| `ai-trace init` | Create `.ai-trace/config.json` |
| `ai-trace index` | Scan → parse → graph → SQLite |
| `ai-trace export` | Export markdown/json for AI |
| `ai-trace trace component <name>` | Trace component flow |
| `ai-trace trace route <path>` | Trace route flow |
| `ai-trace trace hook <name>` | Trace hook usage |
| `ai-trace cursor init` | Generate `.cursor/rules` |
