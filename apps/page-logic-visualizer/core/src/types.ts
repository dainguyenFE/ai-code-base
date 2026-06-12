export type LogicGraphNodeType =
  | "route"
  | "layout"
  | "page"
  | "slot"
  | "component"
  | "data-fetch"
  | "condition"
  | "loop"
  | "hook"
  | "context"
  | "store"
  | "ui-content"
  | "dynamic-import"
  | "unknown";

/** How data reaches a node */
export type DataSourceKind =
  | "api"
  | "props"
  | "hook"
  | "function"
  | "context"
  | "store";

export type StoreLibrary = "redux" | "zustand" | "mobx" | "custom" | "unknown";

export type LogicGraphEdgeType =
  | "renders"
  | "passes-props"
  | "condition-true"
  | "condition-false"
  | "loop-renders"
  | "calls"
  | "imports"
  | "uses-hook"
  | "hook-input"
  | "hook-output"
  | "displays";

/** Layer for data-flow visualization */
export type NodeCategory = "data" | "logic" | "ui";

export type DataValueKind =
  | "string"
  | "number"
  | "boolean"
  | "list"
  | "object"
  | "function"
  | "unknown";

export type PropKind =
  | "literal"
  | "identifier"
  | "member-expression"
  | "function"
  | "object"
  | "unknown";

export interface PropUsage {
  name: string;
  expression: string;
  kind: PropKind;
  /** Source span for this JSX attribute (prop trace / source jump). */
  loc?: SourceLocation;
}

export type ConditionKind = "logical-and" | "ternary" | "if-return" | "unknown";

export interface ConditionMeta {
  expression: string;
  kind: ConditionKind;
}

export type LoopKind = "map" | "for" | "unknown";

export interface LoopMeta {
  sourceExpression: string;
  itemName?: string;
  indexName?: string;
  kind: LoopKind;
}

export interface DataFetchMeta {
  callExpression: string;
  functionName: string;
  importPath?: string;
  awaited: boolean;
}

export interface SourceLocation {
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface LogicGraphNode {
  id: string;
  type: LogicGraphNodeType;
  label: string;
  filePath?: string;
  exportName?: string;
  importPath?: string;
  packageName?: string;
  props?: PropUsage[];
  condition?: ConditionMeta;
  loop?: LoopMeta;
  dataFetch?: DataFetchMeta;
  hook?: HookMeta;
  context?: ContextMeta;
  store?: StoreMeta;
  uiContent?: UiContentMeta;
  loc?: SourceLocation;
  /** Props, variables, function vars, hooks declared in this component */
  locals?: UiLocalsMeta;
  metadata?: Record<string, unknown>;
}

export interface LogicGraphEdge {
  id: string;
  source: string;
  target: string;
  type: LogicGraphEdgeType;
  label?: string;
}

export interface SourceFileMeta {
  filePath: string;
  importCount: number;
  isPage: boolean;
  isLayout: boolean;
}

export interface AnalyzerWarning {
  code: string;
  message: string;
  filePath?: string;
  loc?: SourceLocation;
}

export interface PageLogicGraph {
  rootNodeId: string;
  entryFile: string;
  nodes: LogicGraphNode[];
  edges: LogicGraphEdge[];
  files: SourceFileMeta[];
  warnings: AnalyzerWarning[];
}

export interface AnalyzerConfig {
  includeHtmlElements?: boolean;
  includeHtmlTags?: string[];
  ignoreComponents?: string[];
  importantComponentPatterns?: string[];
  maxDepth?: number;
}

export type PageLogicVisualizerConfig = AnalyzerConfig & {
  rootDir: string;
  tsConfigPath?: string;
  workspacePackageDirs?: string[];
  appsDirs?: string[];
};

export interface AnalyzePageFileOptions {
  entryFile: string;
  rootDir?: string;
  tsConfigPath?: string;
  maxDepth?: number;
  includeHtmlElements?: boolean;
  includeHtmlTags?: string[];
  ignoreComponents?: string[];
}

export interface AnalyzeComponentInFileOptions extends AnalyzePageFileOptions {
  componentName: string;
}

export type RouteTraceMode = "full" | "page-only" | "from-layout";

export interface AnalyzeRouteOptions {
  appDir: string;
  route: string;
  rootDir?: string;
  tsConfigPath?: string;
  maxDepth?: number;
  mode?: RouteTraceMode;
  layoutFile?: string;
  /** Fallback when public URL does not match filesystem path (e.g. private route folders). */
  pageFile?: string;
  includeHtmlElements?: boolean;
  includeHtmlTags?: string[];
}

export interface ResolvedRouteFile {
  route: string;
  pageFile: string;
  layouts: string[];
}

export interface ResolveRouteOptions {
  appDir: string;
  route: string;
  rootDir?: string;
  pageFile?: string;
}

export interface ImportInfo {
  specifier: string;
  moduleSpecifier: string;
  namedImports: string[];
  defaultImport?: string;
  isTypeOnly: boolean;
  resolvedPath?: string;
  packageName?: string;
}
