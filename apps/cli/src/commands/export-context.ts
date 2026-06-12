import { openDatabase } from "@ai-trace/cache";
import { loadConfig } from "@ai-trace/config";
import { exportContext } from "@ai-trace/exporter";

export async function runExport(cwd: string): Promise<void> {
  const config = await loadConfig(cwd);
  const db = openDatabase(config.absoluteDbPath);

  console.log("Exporting context files...");
  const written = await exportContext(db, config.absoluteExportDir);
  db.close();

  for (const filePath of written) {
    console.log(`  ${filePath}`);
  }

  console.log(`Exported ${written.length} files`);
}
