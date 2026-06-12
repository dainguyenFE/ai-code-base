# Code Trace — Agent Instructions

> Generated from `tools/ai-code-trace-agent/templates/agent-instructions/code-trace.md`.
> Regenerate all agent targets: `bun run trace -- agents`

Local code index lives in `.ai-trace/`. **Parser/graph is source of truth; agents explain from indexed context — do not guess flow.**

## When the user asks to trace

Recognize intents such as:

- `Trace component <Name>`
- `Trace hook <Name>`
- `Trace route <path>`
- `Where is <hook> used?`
- `What does <component> render?`

## Required workflow (chat or terminal)

Run from **repo root**:

1. **CLI trace first** (fast graph from SQLite index):
   - `bun run trace -- component <Name>`
   - `bun run trace -- hook <Name>`
   - `bun run trace -- route "<path>"`
2. **Read exports** if more detail is needed:
   - `.ai-trace/exports/symbols.json` — symbol metadata
   - `.ai-trace/exports/graph.json` — nodes and edges
   - `.ai-trace/exports/component-map.md` — render trees
   - `.ai-trace/exports/hook-map.md` — hook usage
   - `.ai-trace/exports/route-map.md` — route → files
   - `.ai-trace/exports/ai-context.md` — quick index overview
3. **Open real source files** from trace output before final claims.
4. **Answer with file paths and line ranges.** State uncertainty when index has no inbound edges.

## Index maintenance

If code changed significantly:

```bash
bun run trace -- index
bun run trace -- export
```

Optional external LLM (Ollama/OpenAI): `bun run trace -- component <Name> -- --ai`

## Response format

Include:

- **Summary** — what the symbol does
- **Entry** — file path + line range
- **Render tree / hook usage / route files** — from graph edges
- **Related files**
- **Warnings** — e.g. "used by: unknown", missing index data

## Rules

- Do not invent files, props, hooks, or routes not in index or source.
- Prefer graph edges over assumptions.
- If symbol not found: say "not found in index" and suggest `bun run trace -- index`.
- Chat in this IDE does **not** need Ollama/OpenAI — use CLI + exports + source.

## Project folders (after index)

- `apps/*/src/app/` — Next.js routes, layouts, loading/error
- `apps/*/src/components/`, `packages/ui/` — UI components
- `hooks/`, `packages/*/src/hooks/` — custom hooks
- `lib/`, `features/` — services and utilities

## Examples (simple → complex)

See `docs/agents/code-trace-examples.md` for copy-paste prompts and expected CLI output:

| Level | Topic                 | Example                                  |
| ----- | --------------------- | ---------------------------------------- |
| 1     | Leaf component        | `Trace component Bell`                   |
| 2     | Multi-child component | `Trace component Home`                   |
| 3     | Standalone hook       | `Trace hook useIsMobile`                 |
| 4     | Hook + consumers      | `Where is useSidebar used?`              |
| 5     | Page component        | `Trace component CreativeStudioHome`     |
| 6     | Route                 | `Trace route "/[locale]/blogs/[slug]"`   |
| 7     | Full stack            | BlogDetail → useRelatedPosts → route     |
| 8–10  | AI / chat templates   | `bun run trace -- ask`, response formats |
