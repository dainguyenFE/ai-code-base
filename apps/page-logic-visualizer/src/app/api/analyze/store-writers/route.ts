import {
  buildStoreFieldWriterTrace,
  buildUiTree,
} from "@cs/page-logic-visualizer/server";
import type { PageLogicGraph } from "@cs/page-logic-visualizer/server";
import { NextResponse } from "next/server";

import type { UsageFlowGraph } from "@/lib/propUsageFlow";
import { getServerProjectConfig } from "@/lib/server-project-config";
import { buildStoreWriterUsageGraph } from "@/lib/storeWriteFlow";

export async function POST(request: Request) {
  const config = await getServerProjectConfig();
  const body = (await request.json()) as {
    graph: PageLogicGraph;
    storeField: string;
    storeHook?: string;
  };

  try {
    if (!body.storeField) {
      return NextResponse.json(
        { error: "storeField is required" },
        { status: 400 }
      );
    }

    const uiTree = buildUiTree(body.graph);
    const trace = buildStoreFieldWriterTrace(body.graph, body.storeField, {
      rootDir: config.rootDir,
      storeHook: body.storeHook,
      uiTree,
    });

    const writerGraph: UsageFlowGraph = buildStoreWriterUsageGraph(
      trace,
      body.storeHook
    );

    return NextResponse.json({ trace, writerGraph });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Store writer trace failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
