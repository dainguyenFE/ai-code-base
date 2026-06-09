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
  | "fetches"
  | "reads"
  | "writes"
  | "routes_to"
  | "depends_on";

export type GraphNodeType =
  | "file"
  | "route"
  | "component"
  | "hook"
  | "function"
  | "service";

export type ImportInfo = {
  source: string;
  named: string[];
  defaultImport?: string;
  isTypeOnly: boolean;
};

export type ExportInfo = {
  name: string;
  isDefault: boolean;
  isTypeOnly: boolean;
};

export type SymbolInfo = {
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
  hash: string;
  isClientComponent?: boolean;
  isServerComponent?: boolean;
};

export type ScannedFile = {
  path: string;
  absolutePath: string;
  language: "ts" | "tsx" | "js" | "jsx";
  hash: string;
  content: string;
};

export type ParsedFile = {
  filePath: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
  symbols: SymbolInfo[];
  isClientComponent: boolean;
  isServerComponent: boolean;
};

export type GraphNode = {
  id: string;
  type: GraphNodeType;
  label: string;
  filePath?: string;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  metadata?: Record<string, unknown>;
};

export type CodeGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type RouteInfo = {
  id: string;
  path: string;
  pageFile?: string;
  layoutFiles: string[];
  loadingFile?: string;
  errorFile?: string;
  notFoundFile?: string;
  routeHandlerFile?: string;
};

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

export type TraceResult = {
  id: string;
  query: string;
  type: "component_trace" | "hook_trace" | "route_trace";
  summary: string;
  entryPoints: string[];
  relatedFiles: string[];
  relatedSymbols: string[];
  graph: CodeGraph;
  steps: string[];
  warnings: string[];
  createdAt: string;
};
