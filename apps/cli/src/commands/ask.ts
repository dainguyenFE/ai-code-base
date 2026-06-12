import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  detectIntent,
  extractTargetFromQuery,
  resolveAiConfig,
  runAiTrace,
} from "@ai-trace/agent";
import { openDatabase } from "@ai-trace/cache";
import { loadConfig } from "@ai-trace/config";

export async function runAsk(cwd: string, query: string): Promise<void> {
  const config = await loadConfig(cwd);
  const aiConfig = resolveAiConfig(config.ai, true);
  const intent = detectIntent(query);
  const targetName = extractTargetFromQuery(query, intent);

  if (!targetName) {
    throw new Error(
      `Could not extract a target from query "${query}". Try: "trace component BlogDetail", "hook useAuth", or 'route "/pricing"'.`
    );
  }

  if (intent === "unknown" || intent === "data_flow") {
    throw new Error(
      `Intent "${intent}" is not supported yet. Use component, hook, or route queries.`
    );
  }

  const db = openDatabase(config.absoluteDbPath);

  try {
    const output = await runAiTrace({
      aiConfig,
      db,
      intent,
      rootDir: config.rootDir,
      targetName,
      userQuery: query,
    });

    console.log(output.markdown);

    if (aiConfig.saveTraceResult) {
      await saveAiTraceResult(config, `ask-${targetName}`, output);
    }
  } finally {
    db.close();
  }
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
