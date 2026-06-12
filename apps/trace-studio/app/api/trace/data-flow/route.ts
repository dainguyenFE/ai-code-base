import { NextResponse } from "next/server";

import { loadTraceStudioContext, withDatabase } from "@/lib/server/context";
import { getDataFlowTrace } from "@/lib/server/trace-service";

export async function GET(request: Request) {
  try {
    await loadTraceStudioContext();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const focus = searchParams.get("focus") ?? undefined;
    const focusKind = searchParams.get("focusKind") as
      | "prop"
      | "hook"
      | "call"
      | "execution"
      | undefined;

    if (!id) {
      return NextResponse.json(
        { error: "Missing id parameter" },
        { status: 400 }
      );
    }

    const dataFlow = await withDatabase((db) =>
      getDataFlowTrace(db, id, focus, focusKind)
    );
    return NextResponse.json(dataFlow);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 }
    );
  }
}
