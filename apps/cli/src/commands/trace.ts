import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  formatHookTrace,
  formatRouteTrace,
  formatTraceResult,
  intentFromTraceType,
  resolveAiConfig,
  runAiTrace,
  traceComponent,
  traceHook,
  traceRoute,
} from "@ai-trace/agent";
import { openDatabase } from "@ai-trace/cache";
import { loadConfig } from "@ai-trace/config";

export interface TraceCommandOptions {
  ai?: boolean;
  file?: string;
}

export async function runTrace(
  cwd: string,
  type: string,
  name: string,
  options: TraceCommandOptions = {}
): Promise<void> {
  const config = await loadConfig(cwd);
  const db = openDatabase(config.absoluteDbPath);

  try {
    if (options.ai) {
      const aiConfig = resolveAiConfig(config.ai, true);
      const intent = intentFromTraceType(
        type as "component" | "hook" | "route"
      );
      const output = await runAiTrace({
        aiConfig,
        db,
        intent,
        rootDir: config.rootDir,
        targetName: name,
        userQuery: `Trace ${type} ${name}`,
      });

      console.log(output.markdown);

      if (aiConfig.saveTraceResult) {
        await saveAiTraceResult(config, `${type}-${name}`, output);
      }
      return;
    }

    let output = "";

    const traceOptions = { file: options.file };

    if (type === "component") {
      const result = traceComponent(db, name, traceOptions);
      output = formatTraceResult(result);
      await saveTraceResult(config, name, result, output);
    } else if (type === "route") {
      const result = traceRoute(db, name);
      output = formatRouteTrace(result);
      await saveTraceResult(config, `route-${name}`, result, output);
    } else if (type === "hook") {
      const result = traceHook(db, name, traceOptions);
      output = formatHookTrace(result);
      await saveTraceResult(config, `hook-${name}`, result, output);
    } else {
      throw new Error(
        `Unknown trace type: ${type}. Use component, route, or hook.`
      );
    }

    console.log(output);
  } finally {
    db.close();
  }
}

async function saveTraceResult(
  config: Awaited<ReturnType<typeof loadConfig>>,
  slug: string,
  result: ReturnType<typeof traceComponent>,
  markdown: string
) {
  await mkdir(config.absoluteTraceResultDir, { recursive: true });
  const safeSlug = slug
    .replaceAll(/[/\\]+/g, "_")
    .replaceAll(/[^\w._-]+/g, "-");
  const mdPath = path.join(
    config.absoluteTraceResultDir,
    `trace-${safeSlug}.md`
  );
  const jsonPath = path.join(
    config.absoluteTraceResultDir,
    `trace-${safeSlug}.json`
  );

  const warningsBlock =
    result.warnings.length > 0
      ? `\n\n## Warnings\n\n${result.warnings.map((warning) => `- ${warning}`).join("\n")}\n`
      : "";

  await writeFile(
    mdPath,
    `# Trace: ${result.query}\n\n## Summary\n\n${result.summary}${warningsBlock}\n\n## Details\n\n\`\`\`\n${markdown}\n\`\`\`\n`,
    "utf-8"
  );
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
}

async function saveAiTraceResult(
  config: Awaited<ReturnType<typeof loadConfig>>,
  slug: string,
  output: Awaited<ReturnType<typeof runAiTrace>>
) {
  await mkdir(config.absoluteTraceResultDir, { recursive: true });
  const safeSlug = slug
    .replaceAll(/[/\\]+/g, "_")
    .replaceAll(/[^\w._-]+/g, "-");
  const mdPath = path.join(
    config.absoluteTraceResultDir,
    `trace-${safeSlug}.ai.md`
  );
  const jsonPath = path.join(
    config.absoluteTraceResultDir,
    `trace-${safeSlug}.ai.json`
  );

  await writeFile(mdPath, `${output.markdown}\n`, "utf-8");
  await writeFile(
    jsonPath,
    `${JSON.stringify(output.result, null, 2)}\n`,
    "utf-8"
  );
}
