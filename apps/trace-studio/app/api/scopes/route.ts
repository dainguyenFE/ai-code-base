import { NextResponse } from "next/server";

import { loadTraceStudioContext } from "@/lib/server/context";
import { getScopes } from "@/lib/server/trace-service";

export async function GET() {
  try {
    const ctx = await loadTraceStudioContext();
    const scopesConfig = (
      ctx.config as { scopes?: Record<string, { type: string }> }
    ).scopes;

    return NextResponse.json(getScopes(ctx.scope, scopesConfig));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
