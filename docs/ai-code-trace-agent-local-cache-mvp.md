# AI Code Trace Agent - Local Cache MVP

## 1. Mục tiêu

Build một AI Agent dùng để trace codebase, tập trung vào:

- Trace route flow
- Trace component render tree
- Trace props flow
- Trace hook logic
- Trace store/state usage
- Trace API/data flow
- Trace loading/error/parallel route trong Next.js
- Tạo output để AI khác như Cursor, Claude, ChatGPT, Continue có thể đọc lại

Phạm vi hiện tại:

> Chỉ build local MVP.  
> Chưa cần share nhiều member.  
> Chưa cần permission, workspace, team comment, cloud sync.

---

## 2. Kiến trúc tổng quát local

```txt
Source Code Repo
   ↓
Local Scanner
   ↓
AST Parser
   ↓
Code Graph Builder
   ↓
Local Cache / Local DB
   ↓
Agent Query Engine
   ↓
Output Files for AI / Cursor
```

MVP nên chạy như một local CLI hoặc local dev server.

Ví dụ:

```bash
ai-trace index
ai-trace trace route /blogs/[slug]
ai-trace trace component BlogDetail
ai-trace export
```

---

## 3. Các module chính

```txt
packages/
  trace-core/
  trace-parser/
  trace-graph/
  trace-agent/
  trace-cache/
  trace-exporter/
```

Nếu làm trong turborepo:

```txt
apps/
  trace-cli/
  trace-web/

packages/
  code-parser/
  code-graph/
  agent-skills/
  trace-types/
  trace-cache/
```

---

## 4. Local Cache cần lưu gì?

Local cache không chỉ lưu response của AI.  
Quan trọng hơn là lưu index của codebase.

Cần cache các nhóm dữ liệu sau:

```txt
1. File cache
2. Symbol cache
3. Graph cache
4. Route cache
5. Embedding cache
6. LLM summary cache
7. Trace result cache
```

---

# 5. Local DB nên dùng gì?

## Option 1: SQLite

Khuyên dùng cho MVP.

Ưu điểm:

- Gọn
- Chạy local tốt
- Không cần server DB
- Dễ backup
- Dễ commit ignore
- Có thể query nhanh
- Có thể dùng Prisma hoặc Drizzle

Nên lưu DB tại:

```txt
.ai-trace/cache/index.sqlite
```

Hoặc:

```txt
.cache/ai-trace/index.sqlite
```

Không nên commit file này lên git.

```gitignore
.ai-trace/cache/
.cache/ai-trace/
```

---

## Option 2: DuckDB

Phù hợp nếu bạn muốn phân tích dữ liệu lớn.

Ưu điểm:

- Query nhanh
- Hợp cho analytics
- Hợp nếu graph/index lớn

Nhược điểm:

- Không phổ biến bằng SQLite cho app local
- Không cần thiết ở MVP đầu tiên

---

## Option 3: LowDB / JSON file

Phù hợp prototype cực nhanh.

Ví dụ:

```txt
.ai-trace/cache/index.json
```

Ưu điểm:

- Dễ debug
- Dễ đọc bằng mắt

Nhược điểm:

- Chậm khi repo lớn
- Khó query graph
- Khó update incremental

Chỉ nên dùng cho proof of concept.

---

## Khuyến nghị

MVP nên dùng:

```txt
SQLite + JSON snapshot
```

Trong đó:

```txt
SQLite:
- files
- symbols
- edges
- routes
- summaries
- trace results

JSON/Markdown:
- export cho Cursor/AI đọc
```

---

# 6. Cấu trúc thư mục local cache

```txt
.ai-trace/
  config.json
  cache/
    index.sqlite
    embeddings.sqlite
    trace-results/
      trace-login-flow.json
      trace-blog-detail.json
  exports/
    ai-context.md
    code-map.md
    route-map.md
    component-map.md
    hook-map.md
    data-flow-map.md
    cursor-context.md
  snapshots/
    main-abc123/
      index-summary.json
      graph.json
      routes.json
```

Ý nghĩa:

```txt
config.json
  Config của trace tool

cache/index.sqlite
  Local DB chính

cache/embeddings.sqlite
  Nếu muốn tách vector/embedding cache riêng

trace-results/
  Lưu kết quả trace từng câu hỏi

exports/
  File markdown/json để AI khác đọc

snapshots/
  Snapshot theo branch/commit
```

---

# 7. SQLite schema gợi ý

## 7.1 files

```sql
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  repo_id TEXT,
  branch TEXT,
  commit_sha TEXT,
  path TEXT NOT NULL,
  language TEXT,
  hash TEXT NOT NULL,
  is_client_component INTEGER DEFAULT 0,
  is_server_component INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
```

Lưu thông tin từng file đã scan.

Ví dụ:

```txt
components/blog/BlogDetail.tsx
app/[locale]/blogs/[slug]/page.tsx
lib/sanity/blogQuery.ts
```

---

## 7.2 symbols

```sql
CREATE TABLE symbols (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  signature TEXT,
  hash TEXT,
  summary TEXT,
  metadata_json TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

`type` có thể là:

```txt
component
hook
function
store
route
service
constant
type
schema
server_action
api_handler
```

Ví dụ:

```txt
BlogDetail - component
useBlogDetail - hook
getBlogDetail - service
buildPageMetadata - function
```

---

## 7.3 edges

```sql
CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  from_symbol_id TEXT,
  to_symbol_id TEXT,
  type TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT
);
```

`type` có thể là:

```txt
imports
exports
renders
calls
uses_hook
uses_store
passes_prop
fetches
reads
writes
routes_to
depends_on
```

Ví dụ:

```txt
BlogDetail renders BlogHeader
BlogDetail uses_hook useRelatedPosts
page.tsx calls getBlogDetail
ProductDetail passes_prop price to ProductPrice
```

---

## 7.4 routes

```sql
CREATE TABLE routes (
  id TEXT PRIMARY KEY,
  route_path TEXT NOT NULL,
  page_file TEXT,
  layout_files_json TEXT,
  loading_file TEXT,
  error_file TEXT,
  not_found_file TEXT,
  route_handler_file TEXT,
  metadata_json TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

Dùng riêng cho Next.js App Router.

Ví dụ:

```txt
/[locale]/blogs/[slug]
```

Có thể map tới:

```txt
app/[locale]/layout.tsx
app/[locale]/blogs/layout.tsx
app/[locale]/blogs/[slug]/page.tsx
app/[locale]/blogs/[slug]/loading.tsx
app/[locale]/blogs/[slug]/error.tsx
```

---

## 7.5 embeddings

Nếu dùng local embedding:

```sql
CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding_json TEXT,
  hash TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

MVP chưa cần vector search phức tạp.  
Có thể lưu embedding dạng JSON trước.

Nếu muốn tốt hơn thì dùng:

```txt
sqlite-vss
sqlite-vec
Chroma local
LanceDB local
```

---

## 7.6 trace_results

```sql
CREATE TABLE trace_results (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  result_json TEXT,
  result_markdown TEXT,
  related_files_json TEXT,
  related_symbols_json TEXT,
  graph_json TEXT,
  commit_sha TEXT,
  index_version TEXT,
  created_at TEXT
);
```

Dùng để cache kết quả agent đã trả lời.

---

# 8. Cache invalidation local

Cần cache theo hash, không cache theo tên file đơn giản.

## File hash

```txt
file path + file content
```

Nếu file không đổi:

```txt
skip parse
reuse symbols
reuse edges
reuse summaries
```

Nếu file đổi:

```txt
parse lại file
update symbols
update edges liên quan
update summary
update embedding
```

---

## Symbol hash

Mỗi component/hook/function nên có hash riêng.

Ví dụ:

```txt
symbol name + signature + body content
```

Nếu symbol không đổi thì không cần generate summary lại.

---

## Query cache

Trace result chỉ được reuse khi:

```txt
same query_hash
same commit_sha
same index_version
```

Ví dụ:

```txt
Trace BlogDetail
```

Nếu code đổi commit thì nên báo:

```txt
Trace này được tạo từ commit cũ. Nên re-run trace.
```

---

# 9. Config file local

Nên có file:

```txt
.ai-trace/config.json
```

Ví dụ:

```json
{
  "projectName": "my-next-app",
  "framework": "nextjs",
  "router": "app-router",
  "sourceRoots": ["app", "components", "hooks", "lib", "features", "packages"],
  "ignore": ["node_modules", ".next", "dist", "build", "coverage", ".turbo"],
  "cacheDir": ".ai-trace/cache",
  "exportDir": ".ai-trace/exports",
  "indexVersion": "v1"
}
```

---

# 10. Agent skills cần có trong MVP

## 10.1 Repo Scanner Skill

Nhiệm vụ:

```txt
- đọc file tree
- ignore file không cần
- detect framework
- detect package/app trong monorepo
- detect Next.js app directory
```

Output:

```json
{
  "framework": "nextjs",
  "router": "app-router",
  "sourceRoots": ["app", "components", "hooks", "lib"]
}
```

---

## 10.2 AST Parser Skill

Dùng để parse code.

Khuyên dùng:

```txt
ts-morph
```

Cần đọc được:

```txt
- imports
- exports
- function declarations
- arrow functions
- React components
- hooks
- JSX tree
- props
- useEffect
- useMemo
- useCallback
- fetch calls
```

---

## 10.3 Route Analyzer Skill

Dành cho Next.js.

Cần detect:

```txt
- page.tsx
- layout.tsx
- loading.tsx
- error.tsx
- not-found.tsx
- route.ts
- template.tsx
- parallel route @modal
- route group (marketing)
- dynamic route [slug]
- catch-all route [...slug]
- optional catch-all [[...slug]]
```

---

## 10.4 Component Analyzer Skill

Cần trace:

```txt
- component name
- props
- child components
- hooks used
- state used
- event handlers
- conditional render
- server/client component
```

---

## 10.5 Hook Analyzer Skill

Cần trace:

```txt
- hook được dùng ở đâu
- hook gọi hook nào khác
- hook gọi API/service nào
- hook return gì
- hook có side effect không
- dependency array
```

---

## 10.6 Props Flow Skill

Trace parent truyền props xuống child.

Ví dụ:

```txt
page.tsx
  post
    ↓
BlogDetail.post
    ↓
BlogHeader.title
    ↓
h1
```

---

## 10.7 Data Flow Skill

Trace từ API/CMS/store đến UI.

Ví dụ:

```txt
Sanity query
  ↓
getBlogDetail()
  ↓
page.tsx
  ↓
BlogDetail
  ↓
BlogHeader
  ↓
h1
```

---

## 10.8 Source Locator Skill

Mọi kết quả nên có:

```txt
file path
line start
line end
snippet
```

Ví dụ:

```txt
components/blog/BlogDetail.tsx:12-45
```

---

# 11. Agent output gồm những file gì?

Khi build agent trace code, output không nên chỉ là text answer.  
Nên sinh ra bộ file để AI khác có thể đọc lại.

## 11.1 File output chính

```txt
.ai-trace/exports/
  ai-context.md
  code-map.md
  route-map.md
  component-map.md
  hook-map.md
  data-flow-map.md
  store-map.md
  api-map.md
  graph.json
  symbols.json
  routes.json
```

---

## 11.2 ai-context.md

File tổng hợp cho AI đọc nhanh.

Nội dung nên gồm:

```txt
- Project overview
- Framework
- App structure
- Important routes
- Main components
- Main hooks
- Main data flows
- Important conventions
- Where to look first
```

Ví dụ:

```md
# AI Context

## Project

This is a Next.js App Router project.

## Main folders

- app/: routes and layouts
- components/: shared UI components
- hooks/: custom hooks
- lib/: API clients and utilities
- features/: feature modules

## Important routes

- /[locale]/blogs/[slug]
- /[locale]/pricing
- /[locale]/ai-tools/[slug]

## Main flows

### Blog detail flow

app/[locale]/blogs/[slug]/page.tsx
→ getBlogDetail()
→ BlogDetail
→ BlogHeader
→ BlogContent
```

---

## 11.3 code-map.md

Map tổng quan source code.

```md
# Code Map

## Apps

- apps/web
- apps/admin

## Packages

- packages/ui
- packages/seo
- packages/bff

## Important folders

### app/

Contains Next.js App Router routes.

### components/

Contains reusable React components.

### hooks/

Contains custom React hooks.

### lib/

Contains services, fetchers, utils and integrations.
```

---

## 11.4 route-map.md

Map routes.

```md
# Route Map

## /[locale]/blogs/[slug]

Files:

- app/[locale]/blogs/[slug]/page.tsx
- app/[locale]/blogs/[slug]/loading.tsx
- app/[locale]/blogs/[slug]/error.tsx

Layout chain:

- app/layout.tsx
- app/[locale]/layout.tsx
- app/[locale]/blogs/layout.tsx

Data:

- getBlogDetail(slug)
- buildPageMetadata()
```

---

## 11.5 component-map.md

Map component và quan hệ render.

```md
# Component Map

## BlogDetail

File:

- components/blog/BlogDetail.tsx

Props:

- post

Renders:

- BlogHeader
- BlogContent
- RelatedPosts
- CTASection

Used by:

- app/[locale]/blogs/[slug]/page.tsx
```

---

## 11.6 hook-map.md

Map hook.

```md
# Hook Map

## useBlogDetail

File:

- hooks/useBlogDetail.ts

Used by:

- BlogDetailPage
- PreviewBlogPage

Calls:

- blogService.getDetail
- useSWR

Returns:

- data
- isLoading
- error
```

---

## 11.7 data-flow-map.md

Map data flow chính.

```md
# Data Flow Map

## Blog Detail Data Flow

Source:

- Sanity CMS

Flow:

1. app/[locale]/blogs/[slug]/page.tsx receives params.slug
2. page.tsx calls getBlogDetail(slug)
3. getBlogDetail calls Sanity query
4. page.tsx passes post to BlogDetail
5. BlogDetail passes post.title to BlogHeader
6. BlogHeader renders h1
```

---

## 11.8 store-map.md

Nếu project có Zustand/Redux.

```md
# Store Map

## useAuthStore

File:

- stores/authStore.ts

State:

- user
- token
- isLoggedIn

Actions:

- setUser
- logout

Used by:

- Header
- UserMenu
- CheckoutPage
```

---

## 11.9 api-map.md

Map service/API.

```md
# API Map

## getBlogDetail

File:

- lib/blog/getBlogDetail.ts

Called by:

- app/[locale]/blogs/[slug]/page.tsx

Calls:

- Sanity query: blogDetailQuery

Returns:

- BlogPost
```

---

## 11.10 graph.json

Dùng cho UI graph hoặc agent khác đọc.

```json
{
  "nodes": [
    {
      "id": "route:/blogs/[slug]",
      "type": "route",
      "label": "/blogs/[slug]"
    },
    {
      "id": "component:BlogDetail",
      "type": "component",
      "label": "BlogDetail"
    }
  ],
  "edges": [
    {
      "from": "route:/blogs/[slug]",
      "to": "component:BlogDetail",
      "type": "renders"
    }
  ]
}
```

---

## 11.11 symbols.json

Danh sách symbol.

```json
{
  "symbols": [
    {
      "id": "component:BlogDetail",
      "name": "BlogDetail",
      "type": "component",
      "file": "components/blog/BlogDetail.tsx",
      "startLine": 10,
      "endLine": 80,
      "summary": "Renders blog detail content."
    }
  ]
}
```

---

## 11.12 routes.json

Danh sách route.

```json
{
  "routes": [
    {
      "path": "/[locale]/blogs/[slug]",
      "page": "app/[locale]/blogs/[slug]/page.tsx",
      "layouts": ["app/layout.tsx", "app/[locale]/layout.tsx"],
      "loading": "app/[locale]/blogs/[slug]/loading.tsx",
      "error": "app/[locale]/blogs/[slug]/error.tsx"
    }
  ]
}
```

---

# 12. Output cho từng câu trace

Ngoài global export, mỗi lần user hỏi trace nên sinh file riêng.

Ví dụ:

```txt
.ai-trace/trace-results/
  trace-blog-detail.md
  trace-blog-detail.json
```

## trace-blog-detail.md

```md
# Trace: BlogDetail

## Summary

BlogDetail is used by the blog detail route and renders blog header, content, related posts and CTA.

## Entry

- app/[locale]/blogs/[slug]/page.tsx

## Component

- components/blog/BlogDetail.tsx

## Props flow

page.tsx
→ BlogDetail.post
→ BlogHeader.title
→ h1

## Hooks

- useRelatedPosts

## Related files

- app/[locale]/blogs/[slug]/page.tsx
- components/blog/BlogDetail.tsx
- components/blog/BlogHeader.tsx
- hooks/useRelatedPosts.ts
```

## trace-blog-detail.json

```json
{
  "query": "Trace BlogDetail",
  "entry": "components/blog/BlogDetail.tsx",
  "summary": "BlogDetail renders blog detail content.",
  "relatedFiles": [
    "app/[locale]/blogs/[slug]/page.tsx",
    "components/blog/BlogDetail.tsx"
  ],
  "graph": {
    "nodes": [],
    "edges": []
  }
}
```

---

# 13. Muốn tích hợp cho Cursor thì cần đặt gì?

Cursor đọc tốt các file context trong repo.  
Bạn nên tạo các file context cố định trong repo.

## 13.1 Tạo file rules cho Cursor

Cursor thường dùng:

```txt
.cursor/rules/
```

Ví dụ:

```txt
.cursor/
  rules/
    project-overview.mdc
    code-trace.mdc
    ai-trace-context.mdc
```

---

## 13.2 project-overview.mdc

```md
---
description: Project overview and architecture
alwaysApply: true
---

# Project Overview

This project uses Next.js App Router, React, TypeScript and Turborepo.

Important folders:

- app/: Next.js routes, layouts, loading and error boundaries
- components/: shared UI components
- hooks/: custom React hooks
- lib/: API clients, services and utilities
- packages/: shared packages

When answering questions about code flow, use `.ai-trace/exports` as the source of truth.
```

---

## 13.3 ai-trace-context.mdc

```md
---
description: AI trace context generated from local code index
alwaysApply: true
---

# AI Trace Context

The generated trace files are located in:

- .ai-trace/exports/ai-context.md
- .ai-trace/exports/code-map.md
- .ai-trace/exports/route-map.md
- .ai-trace/exports/component-map.md
- .ai-trace/exports/hook-map.md
- .ai-trace/exports/data-flow-map.md
- .ai-trace/exports/store-map.md
- .ai-trace/exports/api-map.md

Use these files when explaining:

- route flow
- component render tree
- props flow
- hook logic
- data flow
- API usage
- store usage

Do not guess code flow if generated trace files contain the answer.
```

---

## 13.4 code-trace.mdc

```md
---
description: Rules for tracing code flow
alwaysApply: false
---

# Code Trace Rules

When the user asks to trace a flow:

1. Find the entry point.
2. Check route-map.md if the entry is a route.
3. Check component-map.md if the entry is a component.
4. Check hook-map.md if the entry is a hook.
5. Check data-flow-map.md for API/data flow.
6. Open the real source files before making final claims.
7. Always include file paths.
8. Prefer exact source references over assumptions.

Important generated files:

- .ai-trace/exports/ai-context.md
- .ai-trace/exports/graph.json
- .ai-trace/exports/symbols.json
- .ai-trace/exports/routes.json
```

---

# 14. Có nên commit `.ai-trace` không?

Nên chia làm 2 loại.

## Không commit

```txt
.ai-trace/cache/
.ai-trace/snapshots/
.ai-trace/trace-results/
```

Vì đây là local cache, dễ lớn và thay đổi liên tục.

## Có thể commit

```txt
.ai-trace/exports/*.md
.cursor/rules/*.mdc
```

Nếu team muốn Cursor/AI đọc chung context.

Nhưng hiện tại bạn nói chưa cần share member, thì có thể chưa commit.

---

## .gitignore gợi ý

```gitignore
# AI Trace local cache
.ai-trace/cache/
.ai-trace/snapshots/
.ai-trace/trace-results/

# Optional: ignore generated exports if only local
# .ai-trace/exports/
```

Nếu muốn Cursor đọc được local thì file vẫn nằm trong repo local, không cần commit.

---

# 15. Tích hợp cho Continue / Claude / ChatGPT

Ngoài Cursor, bạn có thể expose output bằng file markdown.

## Continue

Có thể dùng context files:

```txt
.ai-trace/exports/ai-context.md
.ai-trace/exports/code-map.md
.ai-trace/exports/route-map.md
```

## Claude Desktop / ChatGPT

Upload hoặc copy các file:

```txt
ai-context.md
route-map.md
component-map.md
hook-map.md
data-flow-map.md
```

## Local Agent

Agent của bạn có thể đọc trực tiếp:

```txt
.ai-trace/cache/index.sqlite
.ai-trace/exports/*.md
.ai-trace/exports/*.json
```

---

# 16. Agent output format nên chuẩn hóa

Mỗi trace result nên có format:

```json
{
  "id": "trace_xxx",
  "query": "Trace BlogDetail",
  "type": "component_trace",
  "summary": "...",
  "entryPoints": [],
  "relatedFiles": [],
  "relatedSymbols": [],
  "graph": {
    "nodes": [],
    "edges": []
  },
  "steps": [],
  "warnings": [],
  "createdAt": "...",
  "commitSha": "..."
}
```

Trong markdown nên có:

```md
# Trace: Name

## Summary

## Entry Points

## Flow

## Props

## Hooks

## Data Sources

## Related Files

## Warnings
```

---

# 17. CLI command gợi ý

```bash
# Init config
ai-trace init

# Index repo
ai-trace index

# Watch file changes
ai-trace watch

# Trace route
ai-trace trace route "/[locale]/blogs/[slug]"

# Trace component
ai-trace trace component BlogDetail

# Trace hook
ai-trace trace hook useBlogDetail

# Export context files
ai-trace export

# Generate Cursor rules
ai-trace cursor init
```

---

# 18. Agent query flow local

```txt
User asks:
"Trace BlogDetail"

Agent:
1. Search symbol BlogDetail in SQLite
2. Load related graph edges
3. Expand parent/child 1-2 levels
4. Read source snippets
5. Read generated summaries
6. Generate answer
7. Save trace result
8. Export markdown/json if needed
```

---

# 19. MVP build order

## Step 1: Scanner

```txt
- scan file tree
- ignore node_modules, .next, dist
- collect ts/tsx/js/jsx files
```

## Step 2: Parser

```txt
- parse imports/exports
- detect components
- detect hooks
- detect function declarations
```

## Step 3: Graph

```txt
- file imports file
- component renders component
- function calls function
- component uses hook
```

## Step 4: Local DB

```txt
- save files
- save symbols
- save edges
- save routes
```

## Step 5: Export

```txt
- ai-context.md
- code-map.md
- route-map.md
- component-map.md
- hook-map.md
- graph.json
```

## Step 6: Cursor integration

```txt
- generate .cursor/rules/project-overview.mdc
- generate .cursor/rules/ai-trace-context.mdc
- generate .cursor/rules/code-trace.mdc
```

## Step 7: Agent answer

```txt
- read from SQLite
- read from exports
- answer with files + graph
```

---

# 20. Kết luận

Local MVP nên làm như sau:

```txt
Core:
- AST parser
- Code graph
- Local SQLite cache
- Markdown/JSON exports

Cache:
- .ai-trace/cache/index.sqlite
- cache theo file hash, symbol hash, commit sha

Output:
- .ai-trace/exports/ai-context.md
- .ai-trace/exports/code-map.md
- .ai-trace/exports/route-map.md
- .ai-trace/exports/component-map.md
- .ai-trace/exports/hook-map.md
- .ai-trace/exports/data-flow-map.md
- .ai-trace/exports/graph.json
- .ai-trace/exports/symbols.json
- .ai-trace/exports/routes.json

Cursor:
- .cursor/rules/project-overview.mdc
- .cursor/rules/ai-trace-context.mdc
- .cursor/rules/code-trace.mdc
```

Điểm quan trọng:

> AI Agent không nên tự đoán flow từ code raw.  
> Tool cần parse code thành graph trước, cache vào local DB, sau đó AI chỉ đọc graph + source snippet + generated context để trả lời chính xác hơn.
