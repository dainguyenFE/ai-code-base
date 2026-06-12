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

# Trace a component (graph only)
bun ../../apps/cli/src/index.ts trace component BlogDetail

# Trace with AI explanation (Ollama local or OpenAI)
bun ../../apps/cli/src/index.ts trace component BlogDetail --ai
bun ../../apps/cli/src/index.ts ask "trace component BlogDetail"

# Trace a route
bun ../../apps/cli/src/index.ts trace route "/[locale]/blogs/[slug]"

# Generate agent rules (Cursor + Copilot + AGENTS.md) — one consolidated source
bun ../../apps/cli/src/index.ts cursor init
# or from parent repo root:
# bun run trace -- agents
```

From repo root:

```bash
bun run ai-trace init
bun run ai-trace index
bun run ai-trace export
```

## Project structure

```txt
apps/cli/                    CLI entry point
apps/page-logic-visualizer/  Next.js page logic visualizer UI + analyzer
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

## Examples

Progressive examples (leaf component → hook → route → full stack) live in the parent repo:

**[`docs/agents/code-trace-examples.md`](../../docs/agents/code-trace-examples.md)**

Practice symbols in this monorepo: `Bell`, `Home`, `useSidebar`, `useIsMobile`, `CreativeStudioHome`.

**Progressive demo app** (`examples/demo-app/TRACE_EXAMPLES.md`):

| Kind      | L1        | L2         | L3              | L4                    | L5             | L6                       |
| --------- | --------- | ---------- | --------------- | --------------------- | -------------- | ------------------------ |
| Component | Badge     | InfoCard   | StatTile        | DashboardStats        | DashboardShell | BlogDetail               |
| Hook      | useToggle | useCounter | useRelatedPosts | useDashboardData      | —              | —                        |
| Route     | `/`       | `/about`   | `/dashboard`    | `/dashboard/settings` | `/[locale]`    | `/[locale]/blogs/[slug]` |

From parent repo: `bun run trace -- demo:index` then trace with `AI_TRACE_ROOT=tools/ai-code-trace-agent/examples/demo-app`.

## MVP commands

| Command                                | Description                            |
| -------------------------------------- | -------------------------------------- |
| `ai-trace init`                        | Create `.ai-trace/config.json`         |
| `ai-trace index`                       | Scan → parse → graph → SQLite          |
| `ai-trace export`                      | Export markdown/json for AI            |
| `ai-trace trace component <name>`      | Trace component flow                   |
| `ai-trace trace component <name> --ai` | AI explanation from index              |
| `ai-trace ask "<query>"`               | Natural-language trace (AI)            |
| `ai-trace trace route <path>`          | Trace route flow                       |
| `ai-trace trace hook <name>`           | Trace hook usage                       |
| `ai-trace cursor init`                 | Generate agent rules (all targets)     |
| `trace:agents` (parent repo)           | Same — Cursor, Copilot, `docs/agents/` |

## AI config

Add to `.ai-trace/config.json`:

```json
{
  "ai": {
    "enabled": true,
    "provider": "ollama",
    "model": "qwen2.5-coder:7b",
    "baseUrl": "http://localhost:11434",
    "temperature": 0.1,
    "maxContextFiles": 8,
    "maxGraphDepth": 2,
    "saveTraceResult": true
  }
}
```

For OpenAI, set `"provider": "openai"`, `"model": "gpt-4.1-mini"`, and `OPENAI_API_KEY` in `.env.local`.
