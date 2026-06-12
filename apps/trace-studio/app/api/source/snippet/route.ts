import { NextResponse } from "next/server";

import { loadTraceStudioContext } from "@/lib/server/context";
import { getSourceSnippet } from "@/lib/server/trace-service";

export async function GET(request: Request) {
  try {
    const ctx = await loadTraceStudioContext();
    const { searchParams } = new URL(request.url);
    const file = searchParams.get("file");
    const start = Number(searchParams.get("start"));
    const end = Number(searchParams.get("end"));

    if (!file || !start || !end) {
      return NextResponse.json(
        { error: "Missing file, start, or end parameter" },
        { status: 400 }
      );
    }

    const snippet = getSourceSnippet(ctx.workspaceRoot, file, start, end);
    return NextResponse.json(snippet);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 }
    );
  }
}
