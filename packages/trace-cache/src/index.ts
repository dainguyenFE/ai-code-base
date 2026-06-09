export { openDatabase, type TraceDatabase } from "./db.js";
export { SCHEMA_SQL } from "./schema.js";
export {
  findSymbolByName,
  getEdgesForSymbol,
  loadGraph,
  loadRoutes,
  loadSymbols,
  saveIndex,
  type DbSymbol,
  type IndexData,
} from "./saveIndex.js";
