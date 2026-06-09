import type {
  CodeGraph,
  ParsedFile,
  RouteInfo,
  ScannedFile,
  SymbolInfo,
} from "@ai-trace/types";
import type { TraceDatabase } from "./db.js";

function fileId(path: string): string {
  return `file:${path}`;
}

export type IndexData = {
  files: ScannedFile[];
  parsedFiles: ParsedFile[];
  graph: CodeGraph;
  routes: RouteInfo[];
};

export function saveIndex(db: TraceDatabase, data: IndexData): void {
  const now = new Date().toISOString();

  const upsertFile = db.prepare(`
    INSERT INTO files (id, path, language, hash, is_client_component, is_server_component, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      language = excluded.language,
      hash = excluded.hash,
      is_client_component = excluded.is_client_component,
      is_server_component = excluded.is_server_component,
      updated_at = excluded.updated_at
  `);

  const deleteSymbolsForFile = db.prepare(
    `DELETE FROM symbols WHERE file_id = ?`
  );
  const insertSymbol = db.prepare(`
    INSERT OR REPLACE INTO symbols
      (id, file_id, name, type, start_line, end_line, signature, metadata_json, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const clearEdges = db.prepare(`DELETE FROM edges`);
  const insertEdge = db.prepare(`
    INSERT OR REPLACE INTO edges (id, from_id, to_id, type, metadata_json)
    VALUES (?, ?, ?, ?, ?)
  `);

  const upsertRoute = db.prepare(`
    INSERT OR REPLACE INTO routes
      (id, path, page_file, layout_files_json, loading_file, error_file, not_found_file, route_handler_file)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const file of data.files) {
      const parsed = data.parsedFiles.find((p) => p.filePath === file.path);
      upsertFile.run(
        fileId(file.path),
        file.path,
        file.language,
        file.hash,
        parsed?.isClientComponent ? 1 : 0,
        parsed?.isServerComponent ? 1 : 0,
        now
      );

      deleteSymbolsForFile.run(fileId(file.path));

      for (const symbol of parsed?.symbols ?? []) {
        insertSymbol.run(
          symbol.id,
          fileId(file.path),
          symbol.name,
          symbol.type,
          symbol.startLine,
          symbol.endLine,
          symbol.signature ?? null,
          JSON.stringify({
            props: symbol.props,
            calls: symbol.calls,
            renders: symbol.renders,
            usesHooks: symbol.usesHooks,
          }),
          symbol.hash
        );
      }
    }

    clearEdges.run();
    for (const edge of data.graph.edges) {
      insertEdge.run(
        edge.id,
        edge.from,
        edge.to,
        edge.type,
        edge.metadata ? JSON.stringify(edge.metadata) : null
      );
    }

    for (const route of data.routes) {
      upsertRoute.run(
        route.id,
        route.path,
        route.pageFile ?? null,
        JSON.stringify(route.layoutFiles),
        route.loadingFile ?? null,
        route.errorFile ?? null,
        route.notFoundFile ?? null,
        route.routeHandlerFile ?? null
      );
    }
  });

  tx();
}

export type DbSymbol = SymbolInfo & {
  metadata: {
    props?: string[];
    calls?: string[];
    renders?: string[];
    usesHooks?: string[];
  };
};

export function loadSymbols(db: TraceDatabase): DbSymbol[] {
  const rows = db
    .query(
      `SELECT s.*, f.path as file_path FROM symbols s JOIN files f ON s.file_id = f.id`
    )
    .all() as Array<{
    id: string;
    name: string;
    type: string;
    start_line: number;
    end_line: number;
    signature: string | null;
    metadata_json: string | null;
    hash: string;
    file_path: string;
  }>;

  return rows.map((row) => {
    const metadata = row.metadata_json
      ? (JSON.parse(row.metadata_json) as DbSymbol["metadata"])
      : {};

    return {
      id: row.id,
      name: row.name,
      type: row.type as SymbolInfo["type"],
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      signature: row.signature ?? undefined,
      hash: row.hash,
      props: metadata.props,
      calls: metadata.calls,
      renders: metadata.renders,
      usesHooks: metadata.usesHooks,
      metadata,
    };
  });
}

export function loadGraph(db: TraceDatabase): CodeGraph {
  const nodes = db
    .query(
      `SELECT id, type, label, file_path FROM (
        SELECT id, 'file' as type, path as label, path as file_path FROM files
        UNION ALL
        SELECT id, type, name as label, (SELECT path FROM files WHERE id = symbols.file_id) as file_path FROM symbols
        UNION ALL
        SELECT id, 'route' as type, path as label, page_file as file_path FROM routes
      )`
    )
    .all() as Array<{
    id: string;
    type: string;
    label: string;
    file_path: string | null;
  }>;

  const edges = db
    .query(`SELECT id, from_id as "from", to_id as "to", type FROM edges`)
    .all() as CodeGraph["edges"];

  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type as CodeGraph["nodes"][0]["type"],
      label: n.label,
      filePath: n.file_path ?? undefined,
    })),
    edges,
  };
}

export function loadRoutes(db: TraceDatabase): RouteInfo[] {
  const rows = db.query(`SELECT * FROM routes`).all() as Array<{
    id: string;
    path: string;
    page_file: string | null;
    layout_files_json: string | null;
    loading_file: string | null;
    error_file: string | null;
    not_found_file: string | null;
    route_handler_file: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    pageFile: row.page_file ?? undefined,
    layoutFiles: row.layout_files_json
      ? (JSON.parse(row.layout_files_json) as string[])
      : [],
    loadingFile: row.loading_file ?? undefined,
    errorFile: row.error_file ?? undefined,
    notFoundFile: row.not_found_file ?? undefined,
    routeHandlerFile: row.route_handler_file ?? undefined,
  }));
}

export function findSymbolByName(
  db: TraceDatabase,
  name: string,
  type?: string
): DbSymbol | null {
  const symbols = loadSymbols(db).filter((s) => {
    if (s.name !== name) return false;
    if (type && s.type !== type) return false;
    return true;
  });

  return symbols[0] ?? null;
}

export function getEdgesForSymbol(
  db: TraceDatabase,
  symbolId: string
): CodeGraph["edges"] {
  return db
    .query(
      `SELECT id, from_id as "from", to_id as "to", type FROM edges WHERE from_id = ? OR to_id = ?`
    )
    .all(symbolId, symbolId) as CodeGraph["edges"];
}
