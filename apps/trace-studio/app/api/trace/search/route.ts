import { NextResponse } from "next/server";

import { loadTraceStudioContext, withDatabase } from "@/lib/server/context";
import { searchTraceTargets } from "@/lib/server/trace-service";

export async function GET(request: Request) {
  try {
    const ctx = await loadTraceStudioContext();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";
    const scope = searchParams.get("scope") ?? ctx.scope;

    const items = await withDatabase((db) => searchTraceTargets(db, q));

    return NextResponse.json({ items, scope });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
