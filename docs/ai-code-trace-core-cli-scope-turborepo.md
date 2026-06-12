# AI Code Trace Agent - Core Trace & CLI Scope cho Turborepo

## 1. Mục tiêu

Tài liệu này mô tả phần **core trace** và cách sửa CLI/config để hỗ trợ Turborepo nhiều app con.

Ý tưởng chính:

```txt
Workspace = root Turborepo
Scope = app/package/phạm vi cần trace
```

Ví dụ:

```txt
my-platform/
  apps/
    web/
    admin/
    blog/
  packages/
    ui/
    seo/
    bff/
    cms/
```

Không nên hiểu:

```txt
1 project = 1 app nhỏ
```

Mà nên hiểu:

```txt
1 workspace/repo root = target chính
scope = app hoặc package muốn trace
```

---

## 2. Vì sao cần scope?

Trong Turborepo, nhiều app có thể cùng tồn tại:

```txt
apps/web
apps/admin
apps/blog
```

Và nhiều shared package:

```txt
packages/ui
packages/seo
packages/bff
packages/cms
```

Khi trace một component hoặc route, bạn có thể chỉ muốn trace trong `web`, nhưng vẫn cần include shared package liên quan như `ui`, `seo`, `cms`.

Ví dụ:

```txt
scope web:
  apps/web
  packages/ui
  packages/seo
  packages/cms

scope admin:
  apps/admin
  packages/ui
  packages/bff

scope seo:
  packages/seo

scope all:
  apps/*
  packages/*
```

---

## 3. Mô hình đúng

```txt
ai-trace chạy tại repo root
  ↓
đọc .ai-trace/config.json
  ↓
chọn scope
  ↓
scan roots của scope
  ↓
parse AST
  ↓
build graph
  ↓
save cache theo scope
  ↓
trace theo scope
```

Ví dụ:

```bash
cd my-platform

ai-trace init
ai-trace index --scope web
ai-trace trace component Header --scope web
ai-trace trace route "/pricing" --scope web
```

---

## 4. Config mới cho Turborepo

File:

```txt
.ai-trace/config.json
```

Ví dụ:

```json
{
  "projectName": "my-platform",
  "workspaceType": "turborepo",
  "root": ".",
  "defaultScope": "web",
  "scopes": {
    "web": {
      "type": "app",
      "framework": "nextjs",
      "router": "app-router",
      "roots": [
        "apps/web/app",
        "apps/web/components",
        "apps/web/hooks",
        "apps/web/lib",
        "packages/ui",
        "packages/seo",
        "packages/cms"
      ]
    },
    "admin": {
      "type": "app",
      "framework": "nextjs",
      "router": "app-router",
      "roots": [
        "apps/admin/app",
        "apps/admin/components",
        "apps/admin/hooks",
        "apps/admin/lib",
        "packages/ui",
        "packages/bff"
      ]
    },
    "seo": {
      "type": "package",
      "framework": "library",
      "roots": ["packages/seo"]
    },
    "all": {
      "type": "workspace",
      "roots": ["apps", "packages"]
    }
  },
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

## 5. Type config

```ts
export type TraceScopeConfig = {
  type: "app" | "package" | "workspace";
  framework?: "nextjs" | "react" | "library" | "unknown";
  router?: "app-router" | "pages-router" | "unknown";
  roots: string[];
};

export type TraceConfig = {
  projectName: string;
  workspaceType: "single" | "turborepo" | "monorepo";
  root: string;
  defaultScope: string;
  scopes: Record<string, TraceScopeConfig>;
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

## 6. CLI cần sửa như nào?

CLI nên hỗ trợ `--scope`.

```bash
ai-trace index --scope web
ai-trace export --scope web
ai-trace studio --scope web

ai-trace trace component Header --scope web
ai-trace trace route "/pricing" --scope web
ai-trace trace hook useAuth --scope admin
ai-trace trace function buildPageMetadata --scope seo
```

Nếu không truyền `--scope`, dùng `defaultScope`.

```json
{
  "defaultScope": "web"
}
```

---

## 7. Command nên có

```txt
ai-trace init
ai-trace scopes
ai-trace scan --scope web
ai-trace parse --scope web
ai-trace graph --scope web
ai-trace index --scope web
ai-trace export --scope web
ai-trace trace component <name> --scope web
ai-trace trace hook <name> --scope web
ai-trace trace route <path> --scope web
ai-trace studio --scope web
ai-trace clean --scope web
```

Ý nghĩa:

```txt
scopes
  Hiển thị danh sách scope trong config.

scan
  Scan files theo roots của scope.

parse
  Parse AST theo files đã scan.

graph
  Build graph theo scope.

index
  Chạy full pipeline: scan + parse + graph + cache.

export
  Sinh markdown/json context theo scope.

trace
  Query graph/cache theo scope.

studio
  Mở UI với scope mặc định hoặc scope được chọn.

clean
  Xóa cache/export của scope.
```

---

## 8. Package script cho project sử dụng agent

Trong `package.json` của repo cần trace:

```json
{
  "scripts": {
    "trace:scopes": "ai-trace scopes",

    "trace:index": "ai-trace index",
    "trace:index:web": "ai-trace index --scope web",
    "trace:index:admin": "ai-trace index --scope admin",
    "trace:index:all": "ai-trace index --scope all",

    "trace:export": "ai-trace export",
    "trace:export:web": "ai-trace export --scope web",

    "trace:studio": "ai-trace studio",
    "trace:studio:web": "ai-trace studio --scope web",

    "trace:component": "ai-trace trace component",
    "trace:hook": "ai-trace trace hook",
    "trace:route": "ai-trace trace route",

    "trace:all": "pnpm trace:index:web && pnpm trace:export:web && pnpm trace:studio:web"
  }
}
```

---

## 9. Sửa command `index`

`index` phải nhận scope.

Pseudo code:

```ts
type IndexOptions = {
  scope?: string;
};

export async function indexProject(options: IndexOptions) {
  const rootDir = process.cwd();
  const config = await loadConfig(rootDir);

  const scopeName = options.scope ?? config.defaultScope;
  const scope = config.scopes[scopeName];

  if (!scope) {
    throw new Error(`Scope "${scopeName}" not found in .ai-trace/config.json`);
  }

  const files = await scanFiles({
    rootDir,
    sourceRoots: scope.roots,
    ignore: config.ignore,
  });

  const parsedFiles = await parseFiles(files);

  const graph = buildGraph({
    scopeId: scopeName,
    parsedFiles,
  });

  await saveIndex({
    config,
    scopeId: scopeName,
    files,
    parsedFiles,
    graph,
  });
}
```

---

## 10. Sửa scanner

Scanner không đọc `sourceRoots` global nữa.

Nó đọc roots từ scope:

```ts
const files = await scanFiles({
  rootDir,
  sourceRoots: scope.roots,
  ignore: config.ignore,
});
```

Ví dụ scope `web`:

```txt
apps/web/app
apps/web/components
apps/web/hooks
apps/web/lib
packages/ui
packages/seo
packages/cms
```

---

## 11. Sửa cache theo scope

SQLite cần lưu `scope_id`.

### files

```sql
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  path TEXT NOT NULL,
  language TEXT,
  hash TEXT NOT NULL,
  updated_at TEXT
);
```

### symbols

```sql
CREATE TABLE symbols (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  metadata_json TEXT,
  hash TEXT
);
```

### edges

```sql
CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL,
  metadata_json TEXT
);
```

### routes

```sql
CREATE TABLE routes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  path TEXT NOT NULL,
  page_file TEXT,
  layout_files_json TEXT,
  loading_file TEXT,
  error_file TEXT,
  not_found_file TEXT,
  metadata_json TEXT
);
```

---

## 12. Cache shared package xử lý sao?

Một file trong `packages/ui` có thể được dùng bởi nhiều scope.

Ví dụ:

```txt
packages/ui/Button.tsx
  scope web
  scope admin
  scope blog
```

Có 2 cách.

### Cách A: Duplicate theo scope

MVP nên dùng cách này.

Ưu điểm:

```txt
- Dễ làm
- Query đơn giản
- Mỗi scope độc lập
```

Nhược điểm:

```txt
- Parse trùng file
- Cache lớn hơn
```

### Cách B: Global index + scope relation

Sau này tối ưu.

```txt
files
symbols
edges
scope_files
scope_symbols
```

Ví dụ:

```sql
CREATE TABLE scope_files (
  scope_id TEXT NOT NULL,
  file_id TEXT NOT NULL
);
```

Ưu điểm:

```txt
- Không parse trùng file
- Hợp repo lớn
```

Nhược điểm:

```txt
- Query phức tạp hơn
```

---

## 13. Route trace cần scope

Route `/pricing` có thể tồn tại trong nhiều app:

```txt
apps/web/app/pricing/page.tsx
apps/admin/app/pricing/page.tsx
apps/blog/app/pricing/page.tsx
```

Vì vậy trace route nên luôn có scope:

```bash
ai-trace trace route "/pricing" --scope web
```

Nếu không truyền scope và route bị trùng, agent báo:

```txt
Found multiple /pricing routes:

1. apps/web/app/pricing/page.tsx
2. apps/admin/app/pricing/page.tsx

Please select scope:
- web
- admin
```

---

## 14. Export theo scope

Output nên tách theo scope.

```txt
.ai-trace/exports/
  web/
    ai-context.md
    route-map.md
    component-map.md
    hook-map.md
    data-flow-map.md
    graph.json
    symbols.json
    routes.json

  admin/
    ai-context.md
    route-map.md
    component-map.md
    hook-map.md
    graph.json
    symbols.json
    routes.json
```

Command:

```bash
ai-trace export --scope web
```

Sinh:

```txt
.ai-trace/exports/web/*
```

---

## 15. Trace result theo scope

```txt
.ai-trace/trace-results/
  web/
    trace-header.md
    trace-header.json
    trace-pricing-route.md
    trace-pricing-route.json

  admin/
    trace-sidebar.md
    trace-sidebar.json
```

Trace result nên ghi rõ:

```json
{
  "workspace": "my-platform",
  "scope": "web",
  "query": "Trace Header",
  "target": "component:Header",
  "commitSha": "abc123"
}
```

---

## 16. Init có thể auto detect Turborepo

Khi chạy:

```bash
ai-trace init
```

Tool có thể detect:

```txt
turbo.json
pnpm-workspace.yaml
apps/*
packages/*
```

Auto tạo scope cơ bản:

```json
{
  "scopes": {
    "web": {
      "type": "app",
      "roots": ["apps/web"]
    },
    "admin": {
      "type": "app",
      "roots": ["apps/admin"]
    },
    "ui": {
      "type": "package",
      "roots": ["packages/ui"]
    }
  }
}
```

Sau đó user sửa thêm shared packages:

```json
"web": {
  "roots": [
    "apps/web",
    "packages/ui",
    "packages/seo"
  ]
}
```

---

## 17. Core package cần sửa

```txt
packages/
  trace-config/
    - support scopes
    - validate defaultScope
    - resolve roots per scope

  trace-scanner/
    - scan by scope.roots

  trace-parser/
    - no major change

  trace-graph/
    - attach scopeId to nodes/edges

  trace-cache/
    - add workspace_id and scope_id

  trace-exporter/
    - export to .ai-trace/exports/{scope}

  trace-agent/
    - query by scopeId

  cli/
    - add --scope option to commands
```

---

## 18. Build order cho core trace + CLI

```txt
Step 1: Sửa config để có scopes
Step 2: Thêm command ai-trace scopes
Step 3: Sửa index --scope
Step 4: Sửa SQLite schema thêm scope_id
Step 5: Sửa export --scope
Step 6: Sửa trace --scope
Step 7: Sửa studio --scope
```

---

## 19. Kết luận

Với Turborepo, thiết kế đúng là:

```txt
Workspace = repo root
Scope = app/package/phạm vi trace
```

CLI cần hỗ trợ:

```bash
ai-trace index --scope web
ai-trace trace component Header --scope web
ai-trace trace route "/pricing" --scope web
ai-trace studio --scope web
```

Config cần có:

```txt
scopes.web
scopes.admin
scopes.blog
scopes.seo
scopes.all
```

Cache/export/result cần gắn với:

```txt
workspace_id
scope_id
```

MVP nên dùng cách đơn giản:

```txt
Index duplicate theo scope
```

Sau này tối ưu:

```txt
Global file index + scope relation
```
