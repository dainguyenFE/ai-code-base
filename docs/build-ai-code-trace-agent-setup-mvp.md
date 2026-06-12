# Build AI Code Trace Agent - Recommended Stack & Initial Setup

## 1. Mục tiêu

Tài liệu này mô tả nên dùng công nghệ gì để build một AI Agent dùng để trace source code.

Agent này dùng để phân tích:

- Route flow
- Component render tree
- Props flow
- Hook logic
- Store/state usage
- API/data flow
- Quan hệ giữa file, component, hook, function
- Sinh output context để Cursor hoặc AI IDE khác đọc được

Phạm vi MVP:

- Chạy local
- Cache local
- Chưa cần share nhiều member
- Chưa cần cloud
- Chưa cần workspace/team permission
- Chưa cần UI web ở bước đầu
- Chưa cần vector database ngay
- Chưa cần LangChain/LlamaIndex ngay

Nguyên tắc quan trọng:

> Không nên build LLM agent trước.  
> Nên build scanner, parser, graph, cache trước.  
> AI chỉ nên dùng graph + source snippet để trả lời.

---

## 2. Nên dùng stack gì?

## Stack khuyến nghị cho MVP

```txt
Language:
- TypeScript

Runtime:
- Node.js

CLI:
- commander

File scanner:
- fast-glob

AST parser:
- ts-morph
- TypeScript Compiler API

Local DB:
- SQLite
- better-sqlite3

Schema validation:
- zod

Monorepo:
- Turborepo
- pnpm workspace

Exporter:
- Markdown
- JSON

AI IDE integration:
- Cursor project rules
- .cursor/rules/*.mdc
- .ai-trace/exports/*.md
```

---

## 3. Vì sao chọn stack này?

## TypeScript

Nên dùng TypeScript vì chính agent cần đọc TypeScript/React/Next.js.

Lợi ích:

- Dễ định nghĩa type cho File, Symbol, Edge, Route
- Dễ build package nội bộ
- Dễ dùng chung với ts-morph
- Hợp với hệ sinh thái Next.js/React

---

## Node.js

Nên dùng Node.js vì:

- Đọc file system tốt
- Chạy CLI tốt
- Hợp với TypeScript tooling
- Dễ parse project JS/TS
- Dễ tích hợp với Cursor/local IDE

---

## commander

Dùng để build CLI.

Command cần có:

```bash
ai-trace init
ai-trace index
ai-trace export
ai-trace trace component BlogDetail
```

---

## fast-glob

Dùng để scan file nhanh.

Nhiệm vụ:

```txt
- scan app/
- scan components/
- scan hooks/
- scan lib/
- scan packages/
- ignore node_modules, .next, dist, build
```

---

## ts-morph

Đây là phần quan trọng nhất.

`ts-morph` là wrapper trên TypeScript Compiler API, giúp navigate và manipulate TypeScript AST dễ hơn.

Dùng để detect:

```txt
- imports
- exports
- function declarations
- arrow functions
- React components
- custom hooks
- JSX elements
- function calls
- props
- line number
```

Không nên dùng regex để parse code vì dễ sai.

---

## SQLite + better-sqlite3

Dùng SQLite cho local cache.

Lý do:

- Không cần server DB
- Chạy local đơn giản
- Dễ backup
- Dễ query
- Hợp với MVP
- Có thể lưu files, symbols, edges, routes

`better-sqlite3` phù hợp cho Node.js local tool vì API đơn giản và chạy sync, dễ dùng cho CLI.

---

## zod

Dùng để validate config.

Ví dụ validate:

```txt
.ai-trace/config.json
```

Nếu config thiếu `sourceRoots` hoặc `cacheDir`, tool báo lỗi rõ ràng.

---

## Markdown + JSON exporter

Agent nên export 2 loại file:

```txt
Markdown:
- Cho AI/Cursor đọc dễ
- Cho dev đọc dễ

JSON:
- Cho graph UI
- Cho tool khác consume
- Cho trace agent query lại
```

---

## Cursor rules

Cursor có project rules trong `.cursor/rules`.  
Mục tiêu là cho Cursor biết nên đọc `.ai-trace/exports` trước khi trả lời câu hỏi trace flow.

File nên sinh:

```txt
.cursor/rules/ai-trace-context.mdc
.cursor/rules/code-trace.mdc
```

---

# 4. Không nên dùng gì ở MVP đầu tiên?

## Chưa nên dùng LangChain/LlamaIndex

Lý do:

- MVP cần static analysis trước
- Nếu dùng agent framework quá sớm sẽ phức tạp
- Agent dễ trả lời bằng suy đoán nếu chưa có graph
- Cần chứng minh parser/graph đúng trước

Sau này có thể thêm.

---

## Chưa cần vector DB

Chưa cần ngay:

```txt
- Qdrant
- Chroma
- Pinecone
- Weaviate
```

MVP có thể search bằng SQLite trước:

```txt
- search symbol name
- search file path
- search component name
- search hook name
```

Sau này khi repo lớn mới thêm embedding/vector search.

---

## Chưa cần UI web

Bước đầu chỉ cần CLI.

UI web có thể làm sau bằng:

```txt
- Next.js
- React Flow
- Monaco Editor / Shiki
```

---

# 5. Kiến trúc đúng

```txt
Source Code
  ↓
Scanner
  ↓
AST Parser
  ↓
Symbol Extractor
  ↓
Graph Builder
  ↓
Local Cache / SQLite
  ↓
Exporter
  ↓
Trace Agent
  ↓
Cursor / AI IDE
```

Core chính:

```txt
Source Code → AST → Graph → Cache → Export → AI
```

Không nên:

```txt
Source Code → LLM đọc toàn bộ repo → trả lời
```

Vì cách này dễ sai, tốn token và khó kiểm soát.

---

# 6. Project structure đề xuất

Nếu dùng Turborepo:

```txt
ai-code-trace-agent/
  package.json
  turbo.json
  tsconfig.json

  apps/
    cli/
      package.json
      src/
        index.ts
        commands/
          init.ts
          index-project.ts
          export-context.ts
          trace-component.ts
          trace-route.ts

  packages/
    trace-types/
      src/
        index.ts

    trace-config/
      src/
        createDefaultConfig.ts
        loadConfig.ts

    trace-scanner/
      src/
        scanFiles.ts

    trace-parser/
      src/
        parseFile.ts
        parseReactComponent.ts
        parseHook.ts
        parseImports.ts

    trace-graph/
      src/
        buildGraph.ts
        resolveEdges.ts

    trace-cache/
      src/
        db.ts
        schema.ts
        saveIndex.ts
        loadIndex.ts

    trace-exporter/
      src/
        exportMarkdown.ts
        exportJson.ts

    trace-agent/
      src/
        traceComponent.ts
        traceRoute.ts
        traceHook.ts
```

MVP đầu tiên có thể bỏ `trace-agent` và `web`.

Tối thiểu nên có:

```txt
apps/
  cli/

packages/
  trace-types/
  trace-config/
  trace-scanner/
  trace-parser/
  trace-graph/
  trace-cache/
  trace-exporter/
```

---

# 7. Dependencies cần cài

## Root

```bash
pnpm add -D typescript tsup turbo
```

## CLI

```bash
pnpm add commander
```

## Scanner

```bash
pnpm add fast-glob
```

## Parser

```bash
pnpm add ts-morph typescript
```

## Config validation

```bash
pnpm add zod
```

## Local DB

```bash
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3
```

## File utils

```bash
pnpm add fs-extra
pnpm add -D @types/fs-extra
```

Có thể dùng Node built-in `fs/promises` thay cho `fs-extra`.

---

# 8. CLI command cần có

MVP command:

```bash
ai-trace init
ai-trace index
ai-trace export
ai-trace trace component BlogDetail
ai-trace trace route "/[locale]/blogs/[slug]"
```

Ý nghĩa:

```txt
ai-trace init
  Tạo .ai-trace/config.json

ai-trace index
  Scan source code, parse AST, build graph, save SQLite

ai-trace export
  Sinh markdown/json trong .ai-trace/exports

ai-trace trace component BlogDetail
  Trace component từ local DB/cache

ai-trace trace route "/[locale]/blogs/[slug]"
  Trace route từ route map
```

Bước đầu chỉ cần làm được:

```bash
ai-trace init
ai-trace index
ai-trace export
```

---

# 9. CLI entry file

File:

```txt
apps/cli/src/index.ts
```

Ví dụ:

```ts
import { Command } from "commander";

const program = new Command();

program
  .name("ai-trace")
  .description("Local AI code trace agent")
  .version("0.0.1");

program.command("init").action(async () => {
  // create .ai-trace/config.json
});

program.command("index").action(async () => {
  // scan + parse + build graph + save cache
});

program.command("export").action(async () => {
  // export markdown/json files
});

program
  .command("trace")
  .argument("<type>", "component | route | hook")
  .argument("<name>", "symbol name or route path")
  .action(async (type, name) => {
    // trace from local DB
  });

program.parse();
```

---

# 10. Config file của project cần trace

Khi chạy:

```bash
ai-trace init
```

Tool tạo:

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
  "ignore": [
    "node_modules",
    ".next",
    "dist",
    "build",
    "coverage",
    ".turbo",
    ".git"
  ],
  "cacheDir": ".ai-trace/cache",
  "exportDir": ".ai-trace/exports",
  "traceResultDir": ".ai-trace/trace-results",
  "indexVersion": "v1",
  "db": {
    "type": "sqlite",
    "path": ".ai-trace/cache/index.sqlite"
  }
}
```

---

# 11. Module `trace-config`

Nhiệm vụ:

```txt
- Tạo config mặc định
- Đọc config
- Validate config
- Resolve absolute path
```

Files:

```txt
packages/trace-config/src/createDefaultConfig.ts
packages/trace-config/src/loadConfig.ts
```

Type:

```ts
export type TraceConfig = {
  projectName: string;
  framework: "nextjs" | "react" | "unknown";
  router?: "app-router" | "pages-router" | "unknown";
  sourceRoots: string[];
  ignore: string[];
  cacheDir: string;
  exportDir: string;
  traceResultDir: string;
  indexVersion: string;
  db: {
    type: "sqlite";
    path: string;
  };
};
```

---

# 12. Module `trace-scanner`

Nhiệm vụ:

```txt
- Đọc file tree
- Lọc source file
- Bỏ qua file build/cache
- Tính hash cho từng file
```

Files:

```txt
packages/trace-scanner/src/scanFiles.ts
```

Input:

```ts
type ScanInput = {
  rootDir: string;
  sourceRoots: string[];
  ignore: string[];
};
```

Output:

```ts
type ScannedFile = {
  path: string;
  absolutePath: string;
  language: "ts" | "tsx" | "js" | "jsx";
  hash: string;
  content: string;
};
```

Chỉ nên scan:

```txt
.ts
.tsx
.js
.jsx
```

Nên ignore:

```txt
node_modules
.next
dist
build
coverage
.turbo
.git
```

---

# 13. Module `trace-parser`

Nhiệm vụ:

```txt
- Parse AST
- Extract imports
- Extract exports
- Detect component
- Detect custom hook
- Detect function
- Detect JSX render
- Detect hook usage
- Detect function call
```

Khuyên dùng:

```txt
ts-morph
```

File:

```txt
packages/trace-parser/src/parseFile.ts
```

Input:

```ts
type ParseInput = {
  file: ScannedFile;
};
```

Output:

```ts
type ParsedFile = {
  filePath: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
  symbols: SymbolInfo[];
};
```

Type:

```ts
export type SymbolInfo = {
  id: string;
  name: string;
  type: "component" | "hook" | "function" | "service" | "constant";
  filePath: string;
  startLine: number;
  endLine: number;
  props?: string[];
  calls?: string[];
  renders?: string[];
  usesHooks?: string[];
  hash: string;
};
```

Ví dụ input:

```tsx
export function BlogDetail({ post }: Props) {
  const related = useRelatedPosts(post.category);

  return (
    <div>
      <BlogHeader title={post.title} />
      <BlogContent content={post.content} />
    </div>
  );
}
```

Output mong muốn:

```json
{
  "name": "BlogDetail",
  "type": "component",
  "props": ["post"],
  "usesHooks": ["useRelatedPosts"],
  "renders": ["BlogHeader", "BlogContent"]
}
```

---

# 14. Detect component như thế nào?

Một function có thể xem là React component nếu:

```txt
- Tên bắt đầu bằng chữ hoa
- Return JSX
- File là .tsx hoặc .jsx
```

Ví dụ:

```tsx
export function BlogHeader() {
  return <header />;
}
```

Hoặc:

```tsx
export const BlogHeader = () => {
  return <header />;
};
```

---

# 15. Detect hook như thế nào?

Một function có thể xem là hook nếu:

```txt
- Tên bắt đầu bằng use
- Ví dụ: useBlogDetail, useAuthStore, useFeatureFlag
```

Ví dụ:

```ts
export function useBlogDetail(slug: string) {
  return useSWR(["blog", slug], () => getBlogDetail(slug));
}
```

---

# 16. Detect render relation

Nếu JSX có:

```tsx
<BlogHeader title={post.title} />
<BlogContent content={post.content} />
```

Thì tạo relation:

```txt
BlogDetail renders BlogHeader
BlogDetail renders BlogContent
```

Graph edge:

```json
{
  "from": "component:BlogDetail",
  "to": "component:BlogHeader",
  "type": "renders"
}
```

---

# 17. Detect hook usage

Nếu component/hook có:

```ts
const related = useRelatedPosts(post.category);
```

Thì tạo relation:

```txt
BlogDetail uses_hook useRelatedPosts
```

Graph edge:

```json
{
  "from": "component:BlogDetail",
  "to": "hook:useRelatedPosts",
  "type": "uses_hook"
}
```

---

# 18. Module `trace-graph`

Nhiệm vụ:

```txt
- Chuyển ParsedFile thành nodes/edges
- Nối component với component
- Nối component với hook
- Nối function với function
- Nối file import với file
- Nối route với page/layout/loading/error
```

Graph node:

```ts
type GraphNode = {
  id: string;
  type: "file" | "route" | "component" | "hook" | "function" | "service";
  label: string;
  filePath?: string;
};
```

Graph edge:

```ts
type GraphEdge = {
  id: string;
  from: string;
  to: string;
  type:
    | "imports"
    | "renders"
    | "calls"
    | "uses_hook"
    | "passes_prop"
    | "fetches"
    | "routes_to";
};
```

Ví dụ:

```json
{
  "from": "component:BlogDetail",
  "to": "component:BlogHeader",
  "type": "renders"
}
```

---

# 19. Module `trace-cache`

Dùng SQLite để lưu local index.

DB file:

```txt
.ai-trace/cache/index.sqlite
```

MVP schema:

```sql
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  language TEXT,
  hash TEXT NOT NULL,
  is_client_component INTEGER DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE symbols (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  metadata_json TEXT,
  hash TEXT
);

CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL,
  metadata_json TEXT
);

CREATE TABLE routes (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  page_file TEXT,
  layout_files_json TEXT,
  loading_file TEXT,
  error_file TEXT,
  not_found_file TEXT
);
```

Bước đầu chỉ cần lưu:

```txt
files
symbols
edges
```

`routes` có thể làm sau.

---

# 20. Cache invalidation

Không nên parse lại toàn bộ nếu file không đổi.

Dùng hash:

```txt
file hash = hash(file content)
symbol hash = hash(symbol body)
```

Logic:

```txt
Nếu file hash không đổi:
  - skip parse
  - reuse symbols
  - reuse edges

Nếu file hash đổi:
  - parse lại file
  - update symbols
  - update edges
```

---

# 21. Module `trace-exporter`

Nhiệm vụ:

```txt
- Đọc SQLite
- Sinh markdown
- Sinh json
```

Output MVP:

```txt
.ai-trace/exports/
  ai-context.md
  component-map.md
  hook-map.md
  graph.json
  symbols.json
```

Sau này thêm:

```txt
route-map.md
data-flow-map.md
store-map.md
api-map.md
routes.json
```

---

# 22. Output file cho Cursor/AI

Sau khi chạy:

```bash
ai-trace export
```

Sinh:

```txt
.ai-trace/exports/
  ai-context.md
  component-map.md
  hook-map.md
  graph.json
  symbols.json
```

Ví dụ `component-map.md`:

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

Uses hooks:

- useRelatedPosts
```

Ví dụ `graph.json`:

```json
{
  "nodes": [
    {
      "id": "component:BlogDetail",
      "type": "component",
      "label": "BlogDetail"
    },
    {
      "id": "component:BlogHeader",
      "type": "component",
      "label": "BlogHeader"
    }
  ],
  "edges": [
    {
      "from": "component:BlogDetail",
      "to": "component:BlogHeader",
      "type": "renders"
    }
  ]
}
```

---

# 23. Cursor integration để sau

Sau khi exporter chạy ổn, thêm command:

```bash
ai-trace cursor init
```

Command này sinh:

```txt
.cursor/rules/
  ai-trace-context.mdc
  code-trace.mdc
```

Ví dụ:

```md
---
description: AI trace context generated from local code index
alwaysApply: true
---

# AI Trace Context

Use generated files in `.ai-trace/exports` when tracing code flow.

Important files:

- .ai-trace/exports/ai-context.md
- .ai-trace/exports/component-map.md
- .ai-trace/exports/hook-map.md
- .ai-trace/exports/graph.json
- .ai-trace/exports/symbols.json
```

---

# 24. Trace agent làm sau cùng

Sau khi đã có SQLite + graph, mới làm trace agent.

Flow:

```txt
User: Trace BlogDetail

Agent:
1. Tìm symbol BlogDetail trong SQLite
2. Lấy related edges
3. Lấy related files
4. Đọc source snippets
5. Build trace tree
6. Trả lời bằng text
7. Optional: save trace result markdown/json
```

Command:

```bash
ai-trace trace component BlogDetail
```

Output terminal:

```txt
BlogDetail
 ├── file: components/blog/BlogDetail.tsx
 ├── props: post
 ├── renders: BlogHeader, BlogContent
 ├── uses hooks: useRelatedPosts
 └── used by: app/[locale]/blogs/[slug]/page.tsx
```

---

# 25. Sau này mới thêm LLM

Khi core graph chạy tốt, mới thêm LLM.

LLM dùng để:

```txt
- giải thích flow
- summarize component
- tạo natural language answer
- suggest files cần đọc
- detect possible issue
```

LLM không nên là parser chính.

Không nên:

```txt
LLM tự đọc toàn bộ repo và đoán flow
```

Nên:

```txt
Graph query → source snippet → LLM summarize
```

---

# 26. Build order thực tế

## Phase 1: CLI + config

Làm được:

```bash
ai-trace init
```

Output:

```txt
.ai-trace/config.json
```

---

## Phase 2: scanner

Làm được:

```bash
ai-trace index
```

Nhưng lúc này chỉ log file list:

```txt
Found 240 source files
```

---

## Phase 3: parser

Parse được:

```txt
imports
exports
components
hooks
functions
```

Log ví dụ:

```txt
BlogDetail component found
useBlogDetail hook found
getBlogDetail function found
```

---

## Phase 4: cache

Lưu được vào:

```txt
.ai-trace/cache/index.sqlite
```

---

## Phase 5: graph

Sinh được:

```txt
component renders component
component uses hook
function calls function
file imports file
```

---

## Phase 6: export

Sinh được:

```txt
.ai-trace/exports/component-map.md
.ai-trace/exports/hook-map.md
.ai-trace/exports/graph.json
.ai-trace/exports/symbols.json
```

---

## Phase 7: trace command

Làm được:

```bash
ai-trace trace component BlogDetail
```

Output terminal:

```txt
BlogDetail
 ├── renders BlogHeader
 ├── renders BlogContent
 ├── uses hook useRelatedPosts
 └── used by app/[locale]/blogs/[slug]/page.tsx
```

---

## Phase 8: Cursor integration

Sinh được:

```txt
.cursor/rules/ai-trace-context.mdc
.cursor/rules/code-trace.mdc
```

---

## Phase 9: AI integration

Sau cùng mới thêm LLM:

```txt
User query
  ↓
search symbol/graph
  ↓
read related code
  ↓
LLM summarize
```

---

# 27. Kết luận

Nên dùng stack này:

```txt
Core:
- TypeScript
- Node.js
- Turborepo
- pnpm

CLI:
- commander

Scanner:
- fast-glob

Parser:
- ts-morph
- TypeScript Compiler API

Cache:
- SQLite
- better-sqlite3

Config:
- zod

Exporter:
- Markdown
- JSON

Cursor:
- .cursor/rules/*.mdc
- .ai-trace/exports/*.md
```

Thứ tự build đúng:

```txt
1. CLI
2. Config
3. Scanner
4. Parser
5. Graph
6. SQLite cache
7. Export markdown/json
8. Trace command
9. Cursor rules
10. LLM agent
```

MVP đầu tiên chỉ cần đạt được:

```bash
ai-trace trace component BlogDetail
```

Và trả ra:

```txt
BlogDetail
 ├── file: components/blog/BlogDetail.tsx
 ├── props: post
 ├── renders: BlogHeader, BlogContent
 ├── uses hooks: useRelatedPosts
 └── used by: app/[locale]/blogs/[slug]/page.tsx
```

Làm được vậy là core của AI Code Trace Agent đã đúng hướng.
