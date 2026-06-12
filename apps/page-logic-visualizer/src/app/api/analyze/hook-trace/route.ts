import {
  buildHookTraceFromDataLocal,
  buildHookTraceFromEffectLocal,
  buildHookTraceView,
} from "@cs/page-logic-visualizer/server";
import type { PageLogicGraph } from "@cs/page-logic-visualizer/server";
import { NextResponse } from "next/server";

import { getServerProjectConfig } from "@/lib/server-project-config";

export async function POST(request: Request) {
  const config = await getServerProjectConfig();
  const body = (await request.json()) as {
    graph: PageLogicGraph;
    hookNodeId?: string;
    consumerNodeId?: string;
    effectHookName?: string;
    sourceHook?: string;
    fieldName?: string;
    mode?: "hook" | "effect" | "local";
  };

  try {
    const options = { rootDir: config.rootDir };

    if (body.mode === "local" && body.consumerNodeId && body.sourceHook) {
      const trace = buildHookTraceFromDataLocal(
        body.graph,
        body.consumerNodeId,
        body.sourceHook,
        { ...options, fieldName: body.fieldName }
      );
      if (!trace) {
        return NextResponse.json(
          { error: "Hook local trace not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ trace });
    }

    if (body.mode === "effect" && body.consumerNodeId && body.effectHookName) {
      const trace = buildHookTraceFromEffectLocal(
        body.graph,
        body.consumerNodeId,
        body.effectHookName,
        options
      );
      if (!trace) {
        return NextResponse.json(
          { error: "Effect hook trace not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ trace });
    }

    if (!body.hookNodeId) {
      return NextResponse.json(
        { error: "hookNodeId is required" },
        { status: 400 }
      );
    }

    const trace = buildHookTraceView(body.graph, body.hookNodeId, {
      ...options,
      consumerNodeId: body.consumerNodeId,
    });
    if (!trace) {
      return NextResponse.json(
        { error: "Hook trace not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ trace });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Hook trace failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
