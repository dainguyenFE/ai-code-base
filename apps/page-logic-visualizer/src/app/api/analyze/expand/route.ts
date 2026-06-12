import path from "node:path";

import {
  analyzeComponentInFile,
  mergeGraphExpansion,
} from "@cs/page-logic-visualizer/server";
import type { PageLogicGraph } from "@cs/page-logic-visualizer/server";
import { NextResponse } from "next/server";

import { getServerProjectConfig } from "@/lib/server-project-config";

export async function POST(request: Request) {
  const config = await getServerProjectConfig();
  const body = (await request.json()) as {
    graph: PageLogicGraph;
    anchorNodeId: string;
    filePath: string;
    componentName: string;
    maxDepth?: number;
  };

  try {
    const relativeFile = body.filePath.startsWith(config.rootDir)
      ? path.relative(config.rootDir, body.filePath)
      : body.filePath;

    const expansion = analyzeComponentInFile({
      componentName: body.componentName,
      entryFile: relativeFile,
      maxDepth: body.maxDepth ?? 6,
      rootDir: config.rootDir,
    });

    const graph = mergeGraphExpansion({
      anchorNodeId: body.anchorNodeId,
      base: body.graph,
      expansion,
    });

    return NextResponse.json({ graph });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Expand failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
