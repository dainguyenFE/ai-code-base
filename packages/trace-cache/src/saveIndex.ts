import type {
  CodeGraph,
  GraphEdge,
  ParsedFile,
  RouteInfo,
  ScannedFile,
  SymbolInfo,
  SymbolType,
} from "@ai-trace/types";

import type { TraceDatabase } from "./db.js";

function fileId(path: string): string {
  return `file:${path}`;
}

interface FileParsedCache {
  exports: ParsedFile["exports"];
  imports: ParsedFile["imports"];
  isClientComponent: boolean;
  isServerComponent: boolean;
  symbols: SymbolInfo[];
}

function serializeParsedFile(parsed: ParsedFile): string {
  const cache: FileParsedCache = {
    exports: parsed.exports,
    imports: parsed.imports,
    isClientComponent: parsed.isClientComponent,
    isServerComponent: parsed.isServerComponent,
    symbols: parsed.symbols,
  };

  return JSON.stringify(cache);
}

function deserializeParsedFile(
  filePath: string,
  parsedJson: string
): ParsedFile | null {
  try {
    const cache = JSON.parse(parsedJson) as FileParsedCache;

    if (!Array.isArray(cache.imports) || !Array.isArray(cache.symbols)) {
      return null;
    }

    return {
      exports: cache.exports ?? [],
      filePath,
      imports: cache.imports,
      isClientComponent: cache.isClientComponent ?? false,
      isServerComponent: cache.isServerComponent ?? false,
      symbols: cache.symbols.map((symbol) => ({
        ...symbol,
        filePath,
      })),
    };
  } catch {
    return null;
  }
}

export function loadFileHashMap(db: TraceDatabase): Map<string, string> {
  const rows = db.query(`SELECT path, hash FROM files`).all() as {
    path: string;
    hash: string;
  }[];

  return new Map(rows.map((row) => [row.path, row.hash]));
}

export function loadCachedParsedFile(
  db: TraceDatabase,
  filePath: string,
  expectedHash: string
): ParsedFile | null {
  const row = db
    .query(`SELECT hash, parsed_json FROM files WHERE path = ?`)
    .get(filePath) as { hash: string; parsed_json: string | null } | null;

  if (!row || row.hash !== expectedHash || !row.parsed_json) {
    return null;
  }

  return deserializeParsedFile(filePath, row.parsed_json);
}

export function removeStaleFiles(
  db: TraceDatabase,
  currentPaths: string[]
): number {
  const currentPathSet = new Set(currentPaths);
  const staleRows = db.query(`SELECT id, path FROM files`).all() as {
    id: string;
    path: string;
  }[];

  const deleteSymbols = db.prepare(`DELETE FROM symbols WHERE file_id = ?`);
  const deleteFile = db.prepare(`DELETE FROM files WHERE id = ?`);

  let removed = 0;

  const tx = db.transaction(() => {
    for (const row of staleRows) {
      if (currentPathSet.has(row.path)) {
        continue;
      }

      deleteSymbols.run(row.id);
      deleteFile.run(row.id);
      removed += 1;
    }
  });

  tx();

  return removed;
}

export interface IndexData {
  files: ScannedFile[];
  parsedFiles: ParsedFile[];
  graph: CodeGraph;
  routes: RouteInfo[];
}

export function saveIndex(db: TraceDatabase, data: IndexData): void {
  const now = new Date().toISOString();

  const upsertFile = db.prepare(`
    INSERT INTO files (id, path, language, hash, is_client_component, is_server_component, parsed_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      language = excluded.language,
      hash = excluded.hash,
      is_client_component = excluded.is_client_component,
      is_server_component = excluded.is_server_component,
      parsed_json = excluded.parsed_json,
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
        parsed ? serializeParsedFile(parsed) : null,
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
            callSites: symbol.callSites,
            calls: symbol.calls,
            dynamicImports: symbol.dynamicImports,
            executionSteps: symbol.executionSteps,
            passedProps: symbol.passedProps,
            propFlows: symbol.propFlows,
            props: symbol.props,
            renderSites: symbol.renderSites,
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
    callSites?: SymbolInfo["callSites"];
    renderSites?: SymbolInfo["renderSites"];
    executionSteps?: SymbolInfo["executionSteps"];
    renders?: string[];
    usesHooks?: string[];
    passedProps?: SymbolInfo["passedProps"];
    propFlows?: SymbolInfo["propFlows"];
    dynamicImports?: SymbolInfo["dynamicImports"];
  };
};

export function loadSymbols(db: TraceDatabase): DbSymbol[] {
  const rows = db
    .query(
      `SELECT s.*, f.path as file_path FROM symbols s JOIN files f ON s.file_id = f.id`
    )
    .all() as {
    id: string;
    name: string;
    type: string;
    start_line: number;
    end_line: number;
    signature: string | null;
    metadata_json: string | null;
    hash: string;
    file_path: string;
  }[];

  return rows.map((row) => {
    const metadata = row.metadata_json
      ? (JSON.parse(row.metadata_json) as DbSymbol["metadata"])
      : {};

    return {
      callSites: metadata.callSites,
      calls: metadata.calls,
      dynamicImports: metadata.dynamicImports,
      endLine: row.end_line,
      executionSteps: metadata.executionSteps,
      filePath: row.file_path,
      hash: row.hash,
      id: row.id,
      metadata,
      name: row.name,
      passedProps: metadata.passedProps,
      propFlows: metadata.propFlows,
      props: metadata.props,
      renderSites: metadata.renderSites,
      renders: metadata.renders,
      signature: row.signature ?? undefined,
      startLine: row.start_line,
      type: row.type as SymbolInfo["type"],
      usesHooks: metadata.usesHooks,
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
    .all() as {
    id: string;
    type: string;
    label: string;
    file_path: string | null;
  }[];

  const edges = db
    .query(
      `SELECT id, from_id as "from", to_id as "to", type, metadata_json FROM edges`
    )
    .all() as {
    id: string;
    from: string;
    to: string;
    type: string;
    metadata_json: string | null;
  }[];

  return {
    edges: edges.map((edge) => ({
      from: edge.from,
      id: edge.id,
      metadata: edge.metadata_json
        ? (JSON.parse(edge.metadata_json) as GraphEdge["metadata"])
        : undefined,
      to: edge.to,
      type: edge.type as CodeGraph["edges"][0]["type"],
    })),
    nodes: nodes.map((n) => ({
      filePath: n.file_path ?? undefined,
      id: n.id,
      label: n.label,
      type: n.type as CodeGraph["nodes"][0]["type"],
    })),
  };
}

export function loadRoutes(db: TraceDatabase): RouteInfo[] {
  const rows = db.query(`SELECT * FROM routes`).all() as {
    id: string;
    path: string;
    page_file: string | null;
    layout_files_json: string | null;
    loading_file: string | null;
    error_file: string | null;
    not_found_file: string | null;
    route_handler_file: string | null;
  }[];

  return rows.map((row) => ({
    errorFile: row.error_file ?? undefined,
    id: row.id,
    layoutFiles: row.layout_files_json
      ? (JSON.parse(row.layout_files_json) as string[])
      : [],
    loadingFile: row.loading_file ?? undefined,
    notFoundFile: row.not_found_file ?? undefined,
    pageFile: row.page_file ?? undefined,
    path: row.path,
    routeHandlerFile: row.route_handler_file ?? undefined,
  }));
}

export function findSymbolsByName(
  db: TraceDatabase,
  name: string,
  type?: string
): DbSymbol[] {
  return loadSymbols(db).filter((s) => {
    if (s.name !== name) {
      return false;
    }
    if (type && s.type !== type) {
      return false;
    }
    return true;
  });
}

export function findSymbolByName(
  db: TraceDatabase,
  name: string,
  type?: string
): DbSymbol | null {
  return findSymbolsByName(db, name, type)[0] ?? null;
}

function normalizePathHint(fileHint: string): string {
  return fileHint.replaceAll("\\", "/");
}

export function findSymbolByNameAndFile(
  db: TraceDatabase,
  name: string,
  fileHint: string,
  type?: SymbolType
): DbSymbol | null {
  const normalized = normalizePathHint(fileHint);
  const matches = findSymbolsByName(db, name, type);

  return (
    matches.find(
      (symbol) =>
        symbol.filePath === normalized ||
        symbol.filePath.endsWith(normalized) ||
        symbol.filePath.includes(normalized)
    ) ?? null
  );
}

export function listSymbolCandidates(
  db: TraceDatabase,
  name: string,
  type?: SymbolType
): DbSymbol[] {
  return findSymbolsByName(db, name, type);
}

export function loadFileParseMeta(
  db: TraceDatabase,
  filePath: string
): { isClientComponent: boolean; isServerComponent: boolean } | null {
  const row = db
    .query(`SELECT parsed_json FROM files WHERE path = ?`)
    .get(filePath) as { parsed_json: string | null } | null;

  if (!row?.parsed_json) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.parsed_json) as {
      isClientComponent?: boolean;
      isServerComponent?: boolean;
    };
    return {
      isClientComponent: parsed.isClientComponent ?? false,
      isServerComponent: parsed.isServerComponent ?? false,
    };
  } catch {
    return null;
  }
}

export function collectExpandedEdges(
  db: TraceDatabase,
  rootId: string,
  options: {
    depth?: number;
    edgeTypes?: Set<string>;
  } = {}
): CodeGraph["edges"] {
  const depth = options.depth ?? 6;
  const { edgeTypes } = options;
  const collected = new Map<string, CodeGraph["edges"][0]>();
  const visited = new Set<string>();
  let frontier = [rootId];

  for (let level = 0; level < depth && frontier.length > 0; level++) {
    const next: string[] = [];

    for (const nodeId of frontier) {
      if (visited.has(nodeId)) {
        continue;
      }
      visited.add(nodeId);

      for (const edge of getEdgesForSymbol(db, nodeId)) {
        if (edgeTypes && !edgeTypes.has(edge.type)) {
          continue;
        }

        collected.set(edge.id, edge);

        const neighbor = edge.from === nodeId ? edge.to : edge.from;
        if (!visited.has(neighbor)) {
          next.push(neighbor);
        }
      }
    }

    frontier = next;
  }

  return [...collected.values()];
}

export function getEdgesForSymbol(
  db: TraceDatabase,
  symbolId: string
): CodeGraph["edges"] {
  const rows = db
    .query(
      `SELECT id, from_id as "from", to_id as "to", type, metadata_json FROM edges WHERE from_id = ? OR to_id = ?`
    )
    .all(symbolId, symbolId) as {
    id: string;
    from: string;
    to: string;
    type: string;
    metadata_json: string | null;
  }[];

  return rows.map((edge) => ({
    from: edge.from,
    id: edge.id,
    metadata: edge.metadata_json
      ? (JSON.parse(edge.metadata_json) as GraphEdge["metadata"])
      : undefined,
    to: edge.to,
    type: edge.type as CodeGraph["edges"][0]["type"],
  }));
}
