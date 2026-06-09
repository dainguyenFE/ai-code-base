import { loadConfig } from "@ai-trace/config";
import { openDatabase, saveIndex } from "@ai-trace/cache";
import { buildGraph, detectRoutes } from "@ai-trace/graph";
import { parseFiles } from "@ai-trace/parser";
import { scanFiles } from "@ai-trace/scanner";

export async function runIndex(cwd: string): Promise<void> {
  const config = await loadConfig(cwd);

  console.log("Scanning source files...");
  const files = await scanFiles({
    rootDir: config.rootDir,
    sourceRoots: config.sourceRoots,
    ignore: config.ignore,
  });

  console.log(`Found ${files.length} source files`);

  console.log("Parsing AST...");
  const parsedFiles = parseFiles(files);

  const symbolCount = parsedFiles.reduce(
    (sum, file) => sum + file.symbols.length,
    0
  );
  console.log(`Extracted ${symbolCount} symbols`);

  for (const parsed of parsedFiles) {
    for (const symbol of parsed.symbols) {
      console.log(`  ${symbol.name} (${symbol.type}) - ${symbol.filePath}`);
    }
  }

  const routes = detectRoutes(files);
  console.log(`Detected ${routes.length} routes`);

  console.log("Building graph...");
  const graph = buildGraph(parsedFiles, files, routes);
  console.log(
    `Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`
  );

  console.log("Saving to SQLite...");
  const db = openDatabase(config.absoluteDbPath);
  saveIndex(db, { files, parsedFiles, graph, routes });
  db.close();

  console.log(`Index saved to ${config.db.path}`);
}
