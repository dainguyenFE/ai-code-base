import { NextResponse } from "next/server";

import { loadTraceStudioContext, withDatabase } from "@/lib/server/context";
import { getComponentTrace, getTraceNode } from "@/lib/server/trace-service";

export async function GET(request: Request) {
  try {
    const ctx = await loadTraceStudioContext();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const scope = searchParams.get("scope") ?? ctx.scope;
    const view = searchParams.get("view") === "full" ? "full" : "component";

    if (!id) {
      return NextResponse.json(
        { error: "Missing id parameter" },
        { status: 400 }
      );
    }

    const result = await withDatabase((db) =>
      view === "component"
        ? getComponentTrace(db, ctx.workspaceRoot, scope, id)
        : getTraceNode(db, ctx.workspaceRoot, scope, id)
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 404 }
    );
  }
}
