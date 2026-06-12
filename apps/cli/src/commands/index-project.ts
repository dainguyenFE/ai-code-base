import {
  loadCachedParsedFile,
  openDatabase,
  removeStaleFiles,
  saveIndex,
} from "@ai-trace/cache";
import { loadConfig } from "@ai-trace/config";
import { buildGraph, detectRoutes } from "@ai-trace/graph";
import { parseFiles } from "@ai-trace/parser";
import { scanFiles } from "@ai-trace/scanner";

function partitionFilesForParsing(
  db: ReturnType<typeof openDatabase>,
  files: Awaited<ReturnType<typeof scanFiles>>
) {
  const cachedParsed = [];
  const filesToParse = [];
  let skippedCount = 0;

  for (const file of files) {
    const cached = loadCachedParsedFile(db, file.path, file.hash);

    if (cached) {
      cachedParsed.push(cached);
      skippedCount += 1;
      continue;
    }

    filesToParse.push(file);
  }

  return { cachedParsed, filesToParse, skippedCount };
}

export async function runIndex(cwd: string): Promise<void> {
  const config = await loadConfig(cwd);

  console.log("Scanning source files...");
  const files = await scanFiles({
    ignore: config.ignore,
    rootDir: config.rootDir,
    sourceRoots: config.sourceRoots,
  });

  console.log(`Found ${files.length} source files`);

  const db = openDatabase(config.absoluteDbPath);

  const { cachedParsed, filesToParse, skippedCount } = partitionFilesForParsing(
    db,
    files
  );

  if (skippedCount > 0) {
    console.log(`Reusing cache for ${skippedCount} unchanged file(s)`);
  }

  if (filesToParse.length > 0) {
    console.log(`Parsing ${filesToParse.length} changed or new file(s)...`);
  } else {
    console.log("No changed files to parse");
  }

  const freshParsed = parseFiles(filesToParse);
  const parsedFiles = [...cachedParsed, ...freshParsed];

  const symbolCount = parsedFiles.reduce(
    (sum, file) => sum + file.symbols.length,
    0
  );
  console.log(`Resolved ${symbolCount} symbols`);

  for (const parsed of freshParsed) {
    for (const symbol of parsed.symbols) {
      console.log(`  ${symbol.name} (${symbol.type}) - ${symbol.filePath}`);
    }
  }

  const removedCount = removeStaleFiles(
    db,
    files.map((file) => file.path)
  );

  if (removedCount > 0) {
    console.log(`Removed ${removedCount} stale file(s) from cache`);
  }

  const routes = detectRoutes(files);
  console.log(`Detected ${routes.length} routes`);

  console.log("Building graph...");
  const graph = buildGraph(parsedFiles, files, routes);
  console.log(
    `Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`
  );

  console.log("Saving to SQLite...");
  saveIndex(db, { files, graph, parsedFiles, routes });
  db.close();

  console.log(`Index saved to ${config.db.path}`);
}
