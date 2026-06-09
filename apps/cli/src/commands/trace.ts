import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "@ai-trace/config";
import { openDatabase } from "@ai-trace/cache";
import {
  formatRouteTrace,
  formatTraceResult,
  traceComponent,
  traceHook,
  traceRoute,
} from "@ai-trace/agent";

export async function runTrace(
  cwd: string,
  type: string,
  name: string
): Promise<void> {
  const config = await loadConfig(cwd);
  const db = openDatabase(config.absoluteDbPath);

  let output = "";

  if (type === "component") {
    const result = traceComponent(db, name);
    output = formatTraceResult(result);
    await saveTraceResult(config, name, result, output);
  } else if (type === "route") {
    const result = traceRoute(db, name);
    output = formatRouteTrace(result);
    await saveTraceResult(config, `route-${name}`, result, output);
  } else if (type === "hook") {
    const result = traceHook(db, name);
    output = result.steps.map((s) => ` - ${s}`).join("\n");
    await saveTraceResult(config, `hook-${name}`, result, output);
  } else {
    db.close();
    throw new Error(`Unknown trace type: ${type}. Use component, route, or hook.`);
  }

  db.close();
  console.log(output);
}

async function saveTraceResult(
  config: Awaited<ReturnType<typeof loadConfig>>,
  slug: string,
  result: ReturnType<typeof traceComponent>,
  markdown: string
) {
  await mkdir(config.absoluteTraceResultDir, { recursive: true });
  const safeSlug = slug.replace(/[/\\]+/g, "_").replace(/[^\w._-]+/g, "-");
  const mdPath = path.join(
    config.absoluteTraceResultDir,
    `trace-${safeSlug}.md`
  );
  const jsonPath = path.join(
    config.absoluteTraceResultDir,
    `trace-${safeSlug}.json`
  );

  await writeFile(
    mdPath,
    `# Trace: ${result.query}\n\n## Summary\n\n${result.summary}\n\n## Flow\n\n\`\`\`\n${markdown}\n\`\`\`\n`,
    "utf-8"
  );
  await writeFile(jsonPath, JSON.stringify(result, null, 2) + "\n", "utf-8");
}
