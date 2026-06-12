# Gắn AI vào Code Trace Agent sau khi đã có Parser

## 1. Bối cảnh

Bạn đã có một simple parser để đọc source code.

Parser hiện tại có thể parse được một số thông tin như:

- File path
- Import/export
- Component
- Hook
- Function
- JSX render
- Function call
- Quan hệ component gọi component
- Quan hệ component dùng hook

Bước tiếp theo là gắn AI vào để agent có thể trả lời câu hỏi dạng tự nhiên.

Ví dụ:

```txt
Trace component BlogDetail
Hook useAuth được dùng ở đâu?
Route /pricing chạy qua những file nào?
Data post.title đi từ đâu tới UI?
```

Nguyên tắc quan trọng:

> Không đưa toàn bộ source code vào AI.  
> AI chỉ nên nhận context đã được parser lọc ra: symbol, graph, related files, source snippets.

---

## 2. Kiến trúc sau khi gắn AI

```txt
User Question
  ↓
Intent Detector
  ↓
Retriever
  ↓
Context Builder
  ↓
LLM Adapter
  ↓
Trace Agent
  ↓
Answer Formatter
  ↓
Trace Result
```

Flow đầy đủ:

```txt
User hỏi
  ↓
Xác định user muốn trace component/hook/route/data
  ↓
Tìm symbol liên quan trong cache/parser output
  ↓
Lấy graph edges liên quan
  ↓
Lấy source snippet liên quan
  ↓
Build context cho AI
  ↓
Gọi LLM
  ↓
Trả lời dạng markdown/json
  ↓
Lưu trace result
```

---

## 3. Những module cần thêm

Nếu parser đã có rồi, cần thêm các module sau:

```txt
packages/
  trace-retriever/
  trace-context/
  trace-llm/
  trace-agent/
  trace-output/
```

Ý nghĩa:

```txt
trace-retriever
  Lấy symbol, edge, file snippet từ local cache/parser output.

trace-context
  Build prompt/context sạch để đưa vào AI.

trace-llm
  Adapter gọi model: OpenAI, Ollama, Gemini, Anthropic, AI SDK.

trace-agent
  Điều phối toàn bộ flow retrieve → build context → call LLM.

trace-output
  Format và lưu kết quả trace thành markdown/json.
```

Nếu chưa dùng monorepo package riêng, có thể để tạm:

```txt
src/
  retriever/
  context/
  llm/
  agent/
  output/
```

---

## 4. Parser output cần chuẩn hóa trước

AI muốn trả lời tốt thì parser output phải có format ổn định.

### 4.1 SymbolInfo

```ts
export type SymbolInfo = {
  id: string;
  name: string;
  type:
    | "component"
    | "hook"
    | "function"
    | "route"
    | "service"
    | "store"
    | "constant";

  filePath: string;
  startLine: number;
  endLine: number;

  props?: string[];
  renders?: string[];
  usesHooks?: string[];
  calls?: string[];
  imports?: string[];

  hash?: string;
  summary?: string;
};
```

Ví dụ:

```json
{
  "id": "component:BlogDetail",
  "name": "BlogDetail",
  "type": "component",
  "filePath": "components/blog/BlogDetail.tsx",
  "startLine": 10,
  "endLine": 86,
  "props": ["post"],
  "renders": ["BlogHeader", "BlogContent"],
  "usesHooks": ["useRelatedPosts"]
}
```

### 4.2 GraphEdge

```ts
export type GraphEdge = {
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
  metadata?: Record<string, unknown>;
};
```

Ví dụ:

```json
{
  "id": "edge:BlogDetail:BlogHeader",
  "from": "component:BlogDetail",
  "to": "component:BlogHeader",
  "type": "renders"
}
```

### 4.3 FileSnippet

```ts
export type FileSnippet = {
  path: string;
  startLine: number;
  endLine: number;
  code: string;
};
```

---

## 5. Bước 1: tạo Retriever

Retriever là lớp lấy dữ liệu liên quan trước khi gọi AI.

Không nên để AI tự tìm ngay từ đầu.

### 5.1 Input/Output của Retriever

```ts
export type RetrieveInput = {
  query: string;
  targetName?: string;
  intent?:
    | "component_trace"
    | "hook_trace"
    | "route_trace"
    | "data_flow"
    | "unknown";
};

export type RetrievedContext = {
  intent: string;
  targetName?: string;
  symbols: SymbolInfo[];
  edges: GraphEdge[];
  files: FileSnippet[];
  warnings: string[];
};
```

### 5.2 Retriever cho component

Ví dụ user hỏi:

```txt
Trace component BlogDetail
```

Retriever cần làm:

```txt
1. Tìm symbol BlogDetail
2. Lấy outgoing edges
3. Lấy incoming edges
4. Lấy related symbols
5. Lấy source snippet cho symbol chính và symbols liên quan
```

Pseudo code:

```ts
export async function retrieveComponentContext(
  componentName: string
): Promise<RetrievedContext> {
  const symbol = await db.symbols.findByName(componentName);

  if (!symbol) {
    return {
      intent: "component_trace",
      targetName: componentName,
      symbols: [],
      edges: [],
      files: [],
      warnings: [`Component ${componentName} not found in index.`],
    };
  }

  const outgoingEdges = await db.edges.findByFrom(symbol.id);
  const incomingEdges = await db.edges.findByTo(symbol.id);

  const relatedIds = [
    ...outgoingEdges.map((edge) => edge.to),
    ...incomingEdges.map((edge) => edge.from),
  ];

  const relatedSymbols = await db.symbols.findManyByIds(relatedIds);

  const files = await loadSourceSnippets([symbol, ...relatedSymbols]);

  return {
    intent: "component_trace",
    targetName: componentName,
    symbols: [symbol, ...relatedSymbols],
    edges: [...outgoingEdges, ...incomingEdges],
    files,
    warnings: [],
  };
}
```

---

## 6. Bước 2: tạo Intent Detector

MVP có thể dùng rule-based trước, chưa cần AI.

Ví dụ:

```ts
export function detectIntent(query: string) {
  const q = query.toLowerCase();

  if (q.includes("component")) return "component_trace";
  if (q.includes("hook")) return "hook_trace";
  if (q.includes("route")) return "route_trace";
  if (q.includes("data") || q.includes("flow")) return "data_flow";

  return "unknown";
}
```

Ví dụ:

```txt
Trace component BlogDetail
→ component_trace

Hook useAuth dùng ở đâu?
→ hook_trace

Route /pricing chạy qua file nào?
→ route_trace
```

Sau này có thể dùng AI để classify intent, nhưng MVP không cần.

---

## 7. Bước 3: tạo Context Builder

Context Builder biến dữ liệu từ retriever thành prompt cho AI.

### 7.1 Component Trace Context

```ts
export function buildComponentTraceContext(ctx: RetrievedContext) {
  return `
# Code Trace Context

## Intent

${ctx.intent}

## Target

${ctx.targetName}

## Symbols

${ctx.symbols
  .map(
    (symbol) => `
- ${symbol.name}
  - id: ${symbol.id}
  - type: ${symbol.type}
  - file: ${symbol.filePath}
  - lines: ${symbol.startLine}-${symbol.endLine}
  - props: ${symbol.props?.join(", ") || "none"}
  - renders: ${symbol.renders?.join(", ") || "none"}
  - hooks: ${symbol.usesHooks?.join(", ") || "none"}
  - calls: ${symbol.calls?.join(", ") || "none"}
`
  )
  .join("\\n")}

## Graph Edges

${ctx.edges
  .map((edge) => `- ${edge.from} --${edge.type}--> ${edge.to}`)
  .join("\\n")}

## Source Snippets

${ctx.files
  .map(
    (file) => `
### ${file.path}:${file.startLine}-${file.endLine}

\`\`\`tsx
${file.code}
\`\`\`
`
  )
  .join("\\n")}

## Warnings

${ctx.warnings.map((warning) => `- ${warning}`).join("\\n")}
`;
}
```

---

## 8. Bước 4: tạo LLM Adapter

LLM Adapter giúp bạn đổi model dễ.

Nên tạo interface chung:

```ts
export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export interface LLMProvider {
  generate(messages: LLMMessage[]): Promise<string>;
}
```

Sau này bạn có thể có:

```txt
OpenAIProvider
OllamaProvider
GeminiProvider
AnthropicProvider
AISDKProvider
```

### 8.1 Dùng AI SDK

Nếu dùng TypeScript/Node.js, có thể dùng Vercel AI SDK.

Cài:

```bash
pnpm add ai zod
pnpm add @ai-sdk/openai
```

Ví dụ:

```ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

export async function askLLM(prompt: string) {
  const result = await generateText({
    model: openai("gpt-4.1-mini"),
    system: `
You are a code trace assistant.

Rules:
- Only use the provided context.
- Do not invent files, functions, props, or routes.
- If context is missing, say "not found in index".
- Always include file paths.
- Prefer graph edges over assumptions.
- Explain uncertainty clearly.
`,
    prompt,
  });

  return result.text;
}
```

### 8.2 Dùng OpenAI adapter riêng

Nếu không muốn phụ thuộc AI SDK:

```ts
export class OpenAIProvider implements LLMProvider {
  constructor(private apiKey: string) {}

  async generate(messages: LLMMessage[]): Promise<string> {
    // call OpenAI API here
    return "";
  }
}
```

### 8.3 Dùng Ollama local

Nếu muốn chạy local model:

```txt
Ollama + qwen2.5-coder
Ollama + deepseek-coder
```

Config:

```json
{
  "ai": {
    "provider": "ollama",
    "model": "qwen2.5-coder:7b",
    "baseUrl": "http://localhost:11434"
  }
}
```

---

## 9. Bước 5: tạo Trace Agent

Trace Agent là phần điều phối.

```ts
export async function traceComponentAgent(componentName: string) {
  const ctx = await retrieveComponentContext(componentName);

  const context = buildComponentTraceContext(ctx);

  const prompt = `
User wants to trace component: ${componentName}

Use the provided context and return:

1. Summary
2. Entry files
3. Props flow
4. Render tree
5. Hooks used
6. Related files
7. Warnings if uncertain

${context}
`;

  const answer = await askLLM(prompt);

  return answer;
}
```

CLI:

```ts
program
  .command("trace component")
  .argument("<name>")
  .option("--ai", "Use AI explanation")
  .action(async (name, options) => {
    if (options.ai) {
      const answer = await traceComponentAgent(name);
      console.log(answer);
      return;
    }

    // non-AI trace from graph
  });
```

Chạy:

```bash
ai-trace trace component BlogDetail --ai
```

---

## 10. Structured Output

Nên ép AI trả về JSON để dễ lưu.

### 10.1 TraceResult schema

```ts
import { z } from "zod";

export const TraceResultSchema = z.object({
  title: z.string(),
  summary: z.string(),
  entryPoints: z.array(
    z.object({
      file: z.string(),
      lines: z.string().optional(),
    })
  ),
  flow: z.array(
    z.object({
      step: z.number(),
      title: z.string(),
      file: z.string().optional(),
      detail: z.string(),
    })
  ),
  relatedFiles: z.array(z.string()),
  warnings: z.array(z.string()),
});
```

### 10.2 Output JSON mong muốn

```json
{
  "title": "Trace BlogDetail",
  "summary": "BlogDetail renders blog content and related sections.",
  "entryPoints": [
    {
      "file": "components/blog/BlogDetail.tsx",
      "lines": "10-80"
    }
  ],
  "flow": [
    {
      "step": 1,
      "title": "Component receives props",
      "file": "components/blog/BlogDetail.tsx",
      "detail": "BlogDetail receives post as props."
    },
    {
      "step": 2,
      "title": "Render child components",
      "file": "components/blog/BlogDetail.tsx",
      "detail": "BlogDetail renders BlogHeader and BlogContent."
    }
  ],
  "relatedFiles": [
    "components/blog/BlogDetail.tsx",
    "components/blog/BlogHeader.tsx"
  ],
  "warnings": []
}
```

---

## 11. Output Markdown

Sau khi có JSON, có thể render thành Markdown:

```md
# Trace: BlogDetail

## Summary

BlogDetail renders blog content and related sections.

## Entry Points

- components/blog/BlogDetail.tsx:10-80

## Flow

1. Component receives props  
   File: components/blog/BlogDetail.tsx  
   Detail: BlogDetail receives post as props.

2. Render child components  
   File: components/blog/BlogDetail.tsx  
   Detail: BlogDetail renders BlogHeader and BlogContent.

## Related Files

- components/blog/BlogDetail.tsx
- components/blog/BlogHeader.tsx

## Warnings

None.
```

---

## 12. Lưu trace result

Nên lưu mỗi lần trace vào:

```txt
.ai-trace/trace-results/
  trace-blog-detail.md
  trace-blog-detail.json
```

File JSON để tool đọc lại.  
File Markdown để developer đọc.

---

## 13. Config cần thêm

Trong `.ai-trace/config.json`:

```json
{
  "ai": {
    "enabled": true,
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "temperature": 0.1,
    "maxContextFiles": 8,
    "maxGraphDepth": 2,
    "saveTraceResult": true
  }
}
```

Nếu dùng Ollama local:

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

---

## 14. `.env` cần có

Nếu dùng OpenAI:

```bash
OPENAI_API_KEY=xxx
```

Nếu dùng Anthropic:

```bash
ANTHROPIC_API_KEY=xxx
```

Nếu dùng Gemini:

```bash
GOOGLE_GENERATIVE_AI_API_KEY=xxx
```

Không commit `.env`.

```gitignore
.env
.env.local
```

---

## 15. Prompt rule quan trọng

System prompt nên chặt:

```txt
You are a code trace assistant.

Rules:
- Only use the provided context.
- Do not invent files, functions, props, hooks, routes, or APIs.
- If context is missing, say "not found in index".
- Always include file paths.
- Prefer graph edges over assumptions.
- Explain uncertainty clearly.
- Return concise but structured result.
```

Nếu không có rule này, AI rất dễ bịa flow.

---

## 16. Có cần Tool Calling không?

MVP chưa cần.

MVP nên làm flow đơn giản:

```txt
Code tự retrieve context trước
  ↓
Đưa context vào prompt
  ↓
LLM trả lời
```

Sau này mới thêm tool calling:

```txt
findSymbol(name)
getRelatedGraph(symbolId)
getFileSnippet(path, startLine, endLine)
searchRoute(path)
searchHook(name)
```

Tool calling phù hợp khi muốn AI tự gọi thêm dữ liệu.

---

## 17. Thứ tự build thực tế

### Step 1: Lưu parser output

Nếu hiện tại parser chỉ log ra console, hãy lưu nó vào:

```txt
.ai-trace/cache/index.sqlite
```

Hoặc tạm thời:

```txt
.ai-trace/cache/symbols.json
.ai-trace/cache/edges.json
```

### Step 2: Viết retriever

Bắt đầu với component:

```txt
retrieveComponentContext("BlogDetail")
```

Trả về:

```txt
symbol chính
incoming edges
outgoing edges
related symbols
source snippets
```

### Step 3: Viết context builder

Biến retriever output thành markdown context cho AI.

### Step 4: Viết LLM adapter

Chọn một provider trước:

```txt
OpenAI
hoặc Ollama local
```

### Step 5: Viết traceComponentAgent

Command đầu tiên:

```bash
ai-trace trace component BlogDetail --ai
```

### Step 6: Lưu result

Sinh:

```txt
.ai-trace/trace-results/trace-blog-detail.md
.ai-trace/trace-results/trace-blog-detail.json
```

### Step 7: Mở rộng sang hook/route/data

Sau khi component chạy ổn:

```bash
ai-trace trace hook useAuth --ai
ai-trace trace route "/pricing" --ai
ai-trace trace data "post.title" --ai
```

---

## 18. MVP cần làm đúng 1 case trước

Đừng làm quá rộng ngay.

MVP đầu tiên chỉ cần:

```bash
ai-trace trace component BlogDetail --ai
```

Flow:

```txt
BlogDetail
  ↓
find symbol in parser output
  ↓
load related edges
  ↓
load source snippets
  ↓
build prompt
  ↓
call LLM
  ↓
print answer
  ↓
save trace result
```

---

## 19. Kết luận

Bạn đã có parser, vậy bước gắn AI cần:

```txt
1. Retriever
   Lấy symbol/edge/source snippet liên quan.

2. Context Builder
   Biến parser output thành context sạch cho AI.

3. LLM Adapter
   Gọi model qua AI SDK/OpenAI/Ollama.

4. Trace Agent
   Điều phối retrieve → context → LLM → output.

5. Structured Output
   Ép AI trả về JSON/Markdown ổn định.

6. Trace Result Cache
   Lưu .ai-trace/trace-results/*.md/*.json.
```

Cách làm đúng:

```txt
Parser/Graph là nguồn sự thật.
AI chỉ giải thích dựa trên context đã được parser lọc.
```

Không nên:

```txt
Đưa toàn bộ repo vào AI và bắt AI tự đoán.
```
