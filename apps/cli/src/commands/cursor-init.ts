import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const RULES = {
  "project-overview.mdc": `---
description: Project overview and architecture
alwaysApply: true
---

# Project Overview

When answering questions about code flow, use \`.ai-trace/exports\` as the source of truth.

Important folders to check:

- app/: Next.js routes, layouts, loading and error boundaries
- components/: shared UI components
- hooks/: custom React hooks
- lib/: API clients, services and utilities
`,
  "ai-trace-context.mdc": `---
description: AI trace context generated from local code index
alwaysApply: true
---

# AI Trace Context

Generated trace files:

- .ai-trace/exports/ai-context.md
- .ai-trace/exports/code-map.md
- .ai-trace/exports/route-map.md
- .ai-trace/exports/component-map.md
- .ai-trace/exports/hook-map.md
- .ai-trace/exports/graph.json
- .ai-trace/exports/symbols.json

Use these files when explaining route flow, component tree, props flow, hook logic, and data flow.
Do not guess code flow if generated trace files contain the answer.
`,
  "code-trace.mdc": `---
description: Rules for tracing code flow
alwaysApply: false
---

# Code Trace Rules

When the user asks to trace a flow:

1. Find the entry point.
2. Check route-map.md if the entry is a route.
3. Check component-map.md if the entry is a component.
4. Check hook-map.md if the entry is a hook.
5. Open the real source files before making final claims.
6. Always include file paths.
`,
};

export async function runCursorInit(cwd: string): Promise<void> {
  const rulesDir = path.resolve(cwd, ".cursor/rules");
  await mkdir(rulesDir, { recursive: true });

  for (const [fileName, content] of Object.entries(RULES)) {
    const filePath = path.join(rulesDir, fileName);
    await writeFile(filePath, content, "utf-8");
    console.log(`Created ${filePath}`);
  }
}
