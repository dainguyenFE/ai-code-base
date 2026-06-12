export { openDatabase, type TraceDatabase } from "./db.js";
export { SCHEMA_SQL } from "./schema.js";
export {
  findSymbolByName,
  findSymbolByNameAndFile,
  findSymbolsByName,
  collectExpandedEdges,
  getEdgesForSymbol,
  listSymbolCandidates,
  loadCachedParsedFile,
  loadFileHashMap,
  loadFileParseMeta,
  loadGraph,
  loadRoutes,
  loadSymbols,
  removeStaleFiles,
  saveIndex,
  type DbSymbol,
  type IndexData,
} from "./saveIndex.js";
