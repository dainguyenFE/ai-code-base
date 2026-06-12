# AI Code Trace Agent - Trace Studio UI cho Turborepo Scope

## 1. Mục tiêu

Tài liệu này mô tả phần **Trace Studio UI**.

Trace Studio là UI riêng để xem trace code trực quan hơn chat AI.

Mục tiêu:

```txt
- Chọn scope trong Turborepo
- Search component/hook/route
- Hiển thị trace graph
- Click node để trace tiếp
- Xem source code
- Xem detail panel
- Optional: AI explain selected node
```

Trace Studio không thay thế CLI.

```txt
CLI:
  init, scan, parse, index, export, trace terminal

Trace Studio:
  UI để visualize graph và click trace tiếp
```

---

## 2. Vị trí trong monorepo tool

```txt
ai-code-trace-agent/
  apps/
    cli/
    trace-studio/

  packages/
    trace-types/
    trace-config/
    trace-cache/
    trace-graph/
    trace-agent/
```

`trace-studio` dùng lại core packages:

```txt
trace-studio
  ↓
trace-cache
trace-agent
trace-types
trace-config
```

Không viết lại logic trace trong UI.

---

## 3. Trace Studio đọc dữ liệu từ đâu?

Khi user chạy:

```bash
cd my-platform
ai-trace studio --scope web
```

Studio đọc:

```txt
my-platform/.ai-trace/config.json
my-platform/.ai-trace/cache/index.sqlite
my-platform/.ai-trace/exports/web/*
```

Nó không trace source của chính `trace-studio`.

Nó trace target workspace hiện tại.

---

## 4. UI cần Scope Selector

Vì Turborepo có nhiều app, UI cần dropdown scope:

```txt
Scope: web ▼
```

Options lấy từ:

```txt
.ai-trace/config.json -> scopes
```

Ví dụ:

```txt
web
admin
blog
seo
all
```

Khi đổi scope:

```txt
- Search chỉ tìm trong scope đó
- Graph chỉ load nodes/edges trong scope đó
- Route map lấy theo scope đó
- Source snippet vẫn đọc từ workspace root
```

---

## 5. Layout UI đề xuất

```txt
┌──────────────────────────────────────────────────────────────┐
│ Scope: web ▼   Search: BlogDetail                            │
├───────────────┬──────────────────────────────┬───────────────┤
│ Trace Tree    │ Graph View                    │ Detail Panel   │
│               │                              │               │
│ BlogDetail    │ BlogDetail → BlogHeader      │ File path      │
│ ├ BlogHeader  │ BlogDetail → BlogContent     │ Props          │
│ ├ BlogContent │ BlogDetail → useRelatedPosts │ Hooks          │
│ └ useHook     │                              │ Source code    │
└───────────────┴──────────────────────────────┴───────────────┘
```

Panel chính:

```txt
Top:
- Scope selector
- Search input

Left:
- Trace tree

Center:
- Graph view

Right:
- Detail panel
- Source code panel
- AI explain panel
```

---

## 6. UI components

```txt
apps/trace-studio/
  components/
    ScopeSelector.tsx
    TraceSearch.tsx
    TraceGraph.tsx
    TraceTree.tsx
    TraceDetailPanel.tsx
    SourceCodePanel.tsx
    AiExplainPanel.tsx
    TraceToolbar.tsx
```

Ý nghĩa:

```txt
ScopeSelector
  Chọn web/admin/blog/seo/all.

TraceSearch
  Search symbol/route trong scope hiện tại.

TraceGraph
  Render node graph.

TraceTree
  Render tree dạng text dễ nhìn.

TraceDetailPanel
  Show metadata node đang chọn.

SourceCodePanel
  Show source snippet.

AiExplainPanel
  Gọi AI để explain selected node.
```

---

## 7. Tech stack UI

Khuyến nghị:

```txt
Next.js
React Flow
TanStack Query
Zustand
Shiki
react-resizable-panels
```

Cài:

```bash
pnpm add @xyflow/react
pnpm add @tanstack/react-query
pnpm add zustand
pnpm add shiki
pnpm add react-resizable-panels
```

Ghi chú:

```txt
@xyflow/react = React Flow package hiện tại.
Shiki = syntax highlight code read-only.
Monaco = để sau nếu muốn giống IDE.
```

MVP nên dùng Shiki trước.

---

## 8. API route cần có

```txt
apps/trace-studio/app/api/
  scopes/route.ts
  trace/
    search/route.ts
    node/route.ts
  source/
    snippet/route.ts
  ai/
    explain/route.ts
```

MVP cần:

```txt
GET /api/scopes
GET /api/trace/search?scope=web&q=BlogDetail
GET /api/trace/node?scope=web&id=component:BlogDetail
GET /api/source/snippet?file=components/blog/BlogDetail.tsx&start=10&end=80
POST /api/ai/explain
```

---

## 9. API: get scopes

```txt
GET /api/scopes
```

Response:

```json
{
  "defaultScope": "web",
  "items": [
    {
      "id": "web",
      "type": "app",
      "label": "web"
    },
    {
      "id": "admin",
      "type": "app",
      "label": "admin"
    },
    {
      "id": "seo",
      "type": "package",
      "label": "seo"
    }
  ]
}
```

---

## 10. API: search trace target

```txt
GET /api/trace/search?scope=web&q=BlogDetail
```

Response:

```json
{
  "scope": "web",
  "items": [
    {
      "id": "component:BlogDetail",
      "label": "BlogDetail",
      "type": "component",
      "filePath": "components/blog/BlogDetail.tsx",
      "startLine": 10,
      "endLine": 80,
      "traceable": true
    }
  ]
}
```

Search nên hỗ trợ:

```txt
component name
hook name
route path
file path
function name
```

---

## 11. API: trace node

```txt
GET /api/trace/node?scope=web&id=component:BlogDetail
```

Response:

```json
{
  "scope": "web",
  "centerNode": {
    "id": "component:BlogDetail",
    "type": "component",
    "label": "BlogDetail",
    "filePath": "components/blog/BlogDetail.tsx",
    "startLine": 10,
    "endLine": 80,
    "traceable": true
  },
  "nodes": [
    {
      "id": "component:BlogDetail",
      "type": "component",
      "label": "BlogDetail",
      "traceable": true
    },
    {
      "id": "component:BlogHeader",
      "type": "component",
      "label": "BlogHeader",
      "traceable": true
    },
    {
      "id": "hook:useRelatedPosts",
      "type": "hook",
      "label": "useRelatedPosts",
      "traceable": true
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "from": "component:BlogDetail",
      "to": "component:BlogHeader",
      "type": "renders"
    },
    {
      "id": "edge-2",
      "from": "component:BlogDetail",
      "to": "hook:useRelatedPosts",
      "type": "uses_hook"
    }
  ],
  "source": {
    "filePath": "components/blog/BlogDetail.tsx",
    "startLine": 10,
    "endLine": 80,
    "code": "..."
  }
}
```

---

## 12. API: source snippet

```txt
GET /api/source/snippet?file=components/blog/BlogDetail.tsx&start=10&end=80
```

Response:

```json
{
  "filePath": "components/blog/BlogDetail.tsx",
  "startLine": 10,
  "endLine": 80,
  "code": "export function BlogDetail() { ... }"
}
```

Cần bảo vệ path traversal:

```txt
Không cho đọc file ngoài workspace root.
```

---

## 13. API: AI explain selected node

```txt
POST /api/ai/explain
```

Input:

```json
{
  "scope": "web",
  "nodeId": "component:BlogDetail",
  "visibleGraph": {
    "nodes": [],
    "edges": []
  },
  "source": {
    "filePath": "components/blog/BlogDetail.tsx",
    "code": "..."
  }
}
```

Output:

```json
{
  "summary": "BlogDetail receives post as props, renders BlogHeader and BlogContent, and uses useRelatedPosts."
}
```

AI chỉ giải thích context đang chọn, không đọc toàn repo.

---

## 14. Data model cho UI

```ts
export type TraceNode = {
  id: string;
  label: string;
  type:
    | "route"
    | "page"
    | "layout"
    | "component"
    | "hook"
    | "service"
    | "store"
    | "api"
    | "file";
  filePath?: string;
  startLine?: number;
  endLine?: number;
  traceable: boolean;
  metadata?: Record<string, unknown>;
};

export type TraceEdge = {
  id: string;
  from: string;
  to: string;
  type:
    | "renders"
    | "uses_hook"
    | "calls"
    | "imports"
    | "passes_prop"
    | "fetches"
    | "reads_store"
    | "writes_store"
    | "routes_to";
  label?: string;
};

export type SourceSnippet = {
  filePath: string;
  startLine: number;
  endLine: number;
  code: string;
};

export type TraceGraphResponse = {
  scope: string;
  centerNode: TraceNode;
  nodes: TraceNode[];
  edges: TraceEdge[];
  source?: SourceSnippet;
  summary?: string;
};
```

---

## 15. Click node để trace tiếp

Khi click node:

```txt
component:BlogHeader
```

UI gọi:

```txt
GET /api/trace/node?scope=web&id=component:BlogHeader
```

Sau đó:

```txt
1. Merge nodes mới vào graph hiện tại
2. Merge edges mới vào graph hiện tại
3. Set selected node = BlogHeader
4. Load source code BlogHeader
5. Update detail panel
```

Không nên gọi AI tự động khi click node.

Nên chỉ gọi AI khi user bấm:

```txt
Explain selected node
```

---

## 16. Graph UX

Node types:

```txt
Route
Page
Layout
Component
Hook
Service
Store
API
File
```

Edge types:

```txt
renders
uses_hook
calls
imports
passes_prop
fetches
reads_store
writes_store
routes_to
```

Gợi ý hiển thị:

```txt
Node label:
  BlogDetail

Node sublabel:
  component
  components/blog/BlogDetail.tsx
```

Edge label:

```txt
renders
uses hook
calls
imports
```

---

## 17. Trace Tree UX

Trace tree giúp đọc nhanh hơn graph khi nhiều node.

Ví dụ:

```txt
BlogDetail
 ├── renders
 │    ├── BlogHeader
 │    └── BlogContent
 ├── uses hooks
 │    └── useRelatedPosts
 ├── calls
 │    └── getBlogDetail
 └── used by
      └── app/[locale]/blogs/[slug]/page.tsx
```

Click item trong tree cũng trace tiếp giống click graph node.

---

## 18. Detail Panel UX

Khi chọn node:

```txt
Name: BlogDetail
Type: component
Scope: web
File: components/blog/BlogDetail.tsx
Lines: 10-80

Props:
- post

Renders:
- BlogHeader
- BlogContent

Hooks:
- useRelatedPosts

Used by:
- app/[locale]/blogs/[slug]/page.tsx
```

---

## 19. Source Code Panel UX

MVP dùng Shiki.

Hiển thị:

```txt
File path
Line range
Code highlighted
```

Có thể thêm button:

```txt
Open in editor
Copy path
Copy snippet
```

Nếu muốn mở trong VS Code/Cursor sau này:

```txt
cursor://file/path:line
vscode://file/path:line
```

---

## 20. AI Explain Panel UX

Panel này không phải chat chính.

Nên có button:

```txt
Explain selected node
```

Khi bấm:

```txt
Selected node + visible graph + source snippet
  ↓
AI
  ↓
Summary
```

Không đưa toàn repo vào AI.

AI prompt rule:

```txt
Only use the selected node, visible graph and provided source snippet.
Do not invent missing files, hooks, props or routes.
If context is missing, say not found in current trace context.
```

---

## 21. State management

Có thể dùng Zustand.

```ts
type TraceStudioState = {
  scope: string;
  selectedNodeId?: string;
  nodes: TraceNode[];
  edges: TraceEdge[];
  source?: SourceSnippet;
  setScope: (scope: string) => void;
  setSelectedNode: (id: string) => void;
  mergeGraph: (nodes: TraceNode[], edges: TraceEdge[]) => void;
};
```

TanStack Query dùng để fetch API:

```txt
useScopesQuery()
useTraceSearchQuery(scope, q)
useTraceNodeQuery(scope, nodeId)
useExplainMutation()
```

---

## 22. CLI command `studio --scope`

CLI command:

```bash
ai-trace studio --scope web --port 3456
```

Nhiệm vụ:

```txt
1. Load .ai-trace/config.json
2. Validate scope exists
3. Check index.sqlite exists
4. Start trace-studio local server
5. Pass workspaceRoot and defaultScope to studio
```

Nếu chưa index:

```txt
No index found for scope "web".
Run:
  ai-trace index --scope web
```

---

## 23. Environment truyền vào Studio

Khi start studio, cần truyền:

```txt
AI_TRACE_WORKSPACE_ROOT=/path/to/my-platform
AI_TRACE_SCOPE=web
AI_TRACE_DB_PATH=/path/to/my-platform/.ai-trace/cache/index.sqlite
```

API route trong trace-studio dùng env này để đọc cache/source.

---

## 24. MVP build order

```txt
Step 1: Tạo apps/trace-studio
Step 2: Thêm API /api/scopes, /api/trace/search, /api/trace/node, /api/source/snippet
Step 3: Tạo ScopeSelector, TraceSearch, TraceGraph, TraceDetailPanel, SourceCodePanel
Step 4: Click node để trace tiếp
Step 5: Thêm AI explain panel
Step 6: Thêm command ai-trace studio --scope web
```

---

## 25. MVP tối thiểu

MVP chỉ cần:

```txt
1. Scope selector
2. Search symbol
3. Show graph depth 1
4. Click node để trace tiếp
5. Show source code
6. Show detail metadata
```

Chưa cần:

```txt
- Auth
- Multi-user
- Team sharing
- Comment
- CI dashboard
- Full AI chat
```

---

## 26. Kết luận

Trace Studio nên được tách thành app riêng:

```txt
apps/trace-studio
```

Nó dùng lại core trace/cache.

Với Turborepo, UI bắt buộc nên có:

```txt
Scope selector
```

Flow đúng:

```txt
Select scope: web
  ↓
Search BlogDetail
  ↓
Show graph
  ↓
Click BlogHeader
  ↓
Trace tiếp BlogHeader
  ↓
Show source/detail
  ↓
Optional AI explain
```

Nguyên tắc:

```txt
Graph/cache là source of truth.
UI dùng graph để navigate.
AI chỉ dùng selected context để explain.
```
