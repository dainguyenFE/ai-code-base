export type SymbolType =
  | "component"
  | "hook"
  | "function"
  | "service"
  | "constant"
  | "store"
  | "route"
  | "api_handler"
  | "server_action";

export type EdgeType =
  | "imports"
  | "exports"
  | "renders"
  | "calls"
  | "uses_hook"
  | "uses_store"
  | "passes_prop"
  | "prop_source"
  | "dynamic_imports"
  | "fetches"
  | "reads"
  | "writes"
  | "routes_to"
  | "wraps"
  | "shows_loading"
  | "shows_error"
  | "shows_not_found"
  | "depends_on"
  | "sequence";

export type ExecutionStepKind =
  | "call"
  | "hook"
  | "render"
  | "branch"
  | "return";

export type BranchKind = "if" | "early_return" | "ternary";

export interface RenderSiteRecord {
  component: string;
  line: number;
  expression: string;
}

export interface BranchRecord {
  line: number;
  branchKind: BranchKind;
  condition: string;
}

export interface ExecutionStepRecord {
  order: number;
  kind: ExecutionStepKind;
  line: number;
  label: string;
  target?: string;
  expression?: string;
  branchKind?: BranchKind;
  condition?: string;
}

export type DataFlowKind =
  | "identifier"
  | "parameter"
  | "call"
  | "hook_call"
  | "member"
  | "destructure"
  | "literal"
  | "await"
  | "unknown";

export interface DataFlowNode {
  kind: DataFlowKind;
  expression: string;
  line: number;
  name?: string;
  callee?: string;
  property?: string;
  moduleSpecifier?: string;
  children?: DataFlowNode[];
}

export interface PropFlowRecord {
  targetComponent: string;
  propName: string;
  jsxValue: string;
  line: number;
  source: DataFlowNode;
}

export interface CallSiteRecord {
  callee: string;
  expression: string;
  line: number;
  argumentExpressions?: string[];
}

export interface PassedPropAttribute {
  name: string;
  value: string;
}

export interface PassedPropTarget {
  target: string;
  attributes: PassedPropAttribute[];
}

export interface DynamicImportRef {
  moduleSpecifier: string;
  line: number;
  kind: "import()" | "next/dynamic" | "react/lazy";
}

export type GraphNodeType =
  | "file"
  | "route"
  | "layout"
  | "page"
  | "loading"
  | "error"
  | "not_found"
  | "component"
  | "hook"
  | "function"
  | "service"
  | "external"
  | "builtin";

export interface ImportInfo {
  source: string;
  named: string[];
  defaultImport?: string;
  isTypeOnly: boolean;
}

export interface ExportInfo {
  name: string;
  isDefault: boolean;
  isTypeOnly: boolean;
}

export interface SymbolInfo {
  id: string;
  name: string;
  type: SymbolType;
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
  props?: string[];
  calls?: string[];
  renders?: string[];
  usesHooks?: string[];
  passedProps?: PassedPropTarget[];
  propFlows?: PropFlowRecord[];
  callSites?: CallSiteRecord[];
  renderSites?: RenderSiteRecord[];
  executionSteps?: ExecutionStepRecord[];
  dynamicImports?: DynamicImportRef[];
  hash: string;
  isClientComponent?: boolean;
  isServerComponent?: boolean;
}

export interface ScannedFile {
  path: string;
  absolutePath: string;
  language: "ts" | "tsx" | "js" | "jsx";
  hash: string;
  content: string;
}

export interface ParsedFile {
  filePath: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
  symbols: SymbolInfo[];
  isClientComponent: boolean;
  isServerComponent: boolean;
}

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  filePath?: string;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  metadata?: Record<string, unknown>;
}

export interface CodeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RouteInfo {
  id: string;
  path: string;
  pageFile?: string;
  layoutFiles: string[];
  loadingFile?: string;
  errorFile?: string;
  notFoundFile?: string;
  templateFile?: string;
  routeHandlerFile?: string;
}

export type TraceIntent =
  | "component_trace"
  | "hook_trace"
  | "route_trace"
  | "data_flow"
  | "unknown";

export interface AiConfig {
  enabled: boolean;
  provider: "openai" | "ollama";
  model: string;
  baseUrl?: string;
  temperature: number;
  maxContextFiles: number;
  maxGraphDepth: number;
  saveTraceResult: boolean;
}

export interface TraceConfig {
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
  ai?: AiConfig;
}

export interface FileSnippet {
  path: string;
  startLine: number;
  endLine: number;
  code: string;
}

export interface RetrievedContext {
  intent: TraceIntent;
  targetName?: string;
  symbols: SymbolInfo[];
  edges: GraphEdge[];
  files: FileSnippet[];
  warnings: string[];
}

export interface AiTraceFlowStep {
  step: number;
  title: string;
  file?: string;
  detail: string;
}

export interface AiTraceEntryPoint {
  file: string;
  lines?: string;
}

export interface AiTraceResult {
  title: string;
  summary: string;
  entryPoints: AiTraceEntryPoint[];
  flow: AiTraceFlowStep[];
  relatedFiles: string[];
  warnings: string[];
  rawAnswer?: string;
  provider?: string;
  model?: string;
  createdAt: string;
}

export interface TraceResultSections {
  entry?: string[];
  boundary?: string[];
  renderTree?: string[];
  propsPassed?: string[];
  propsReceived?: string[];
  propOrigins?: string[];
  callChain?: string[];
  dynamicImports?: string[];
  hooks?: string[];
  data?: string[];
  usage?: string[];
  route?: string[];
  layouts?: string[];
  related?: string[];
}

export interface TraceResult {
  id: string;
  query: string;
  type: "component_trace" | "hook_trace" | "route_trace";
  summary: string;
  entryPoints: string[];
  relatedFiles: string[];
  relatedSymbols: string[];
  graph: CodeGraph;
  steps: string[];
  sections?: TraceResultSections;
  warnings: string[];
  createdAt: string;
}
