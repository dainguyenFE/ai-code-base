/**
 * Server-only exports for API routes (Node.js fs, ts-morph).
 * Do not import from client components — use `@cs/page-logic-visualizer/client`.
 */
export {
  analyzeComponentInFile,
  analyzePageFile,
} from "./analyzer/analyzeFile";
export {
  analyzeRoute,
  listAppRoutes,
  resolveRouteToFile,
} from "./analyzer/analyzeRoute";
export {
  buildHookTraceFromDataLocal,
  buildHookTraceFromEffectLocal,
  buildHookTraceView,
} from "./graph/hookTrace";
export { buildStoreFieldWriterTrace } from "./graph/storeWriteTrace";
export { buildEnrichedLinearPropFlowGraph } from "./graph/hookPropFlow";
export { buildDataTraceChain, buildUiTree } from "./graph/uiGraph";
export { mergeGraphExpansion } from "./graph/mergeGraph";
export { resolveImport } from "./resolver/resolveImport";
export {
  defaultAppDir,
  findConfigFile,
  listProjectApps,
  resolveProjectConfig,
} from "./project-config";
export type {
  PageLogicVisualizerProjectConfig,
  ProjectType,
  ResolvedProjectConfig,
} from "./project-config";
export type { ResolveImportOptions } from "./resolver/resolveImport";
export type { PageLogicGraph } from "./types";
