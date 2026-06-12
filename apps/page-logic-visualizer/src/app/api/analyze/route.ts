import {
  analyzePageFile,
  analyzeRoute,
  defaultAppDir,
} from "@cs/page-logic-visualizer/server";
import { NextResponse } from "next/server";

import { getServerProjectConfig } from "@/lib/server-project-config";

export async function POST(request: Request) {
  const config = await getServerProjectConfig();
  const body = (await request.json()) as {
    appDir?: string;
    route?: string;
    entryFile?: string;
    maxDepth?: number;
    includeHtmlElements?: boolean;
    routeTraceMode?: "full" | "page-only" | "from-layout";
    layoutFile?: string;
  };

  try {
    const graph =
      body.route && body.appDir
        ? analyzeRoute({
            appDir: body.appDir,
            includeHtmlElements: body.includeHtmlElements ?? false,
            layoutFile: body.layoutFile,
            maxDepth: body.maxDepth ?? 5,
            mode: body.routeTraceMode ?? "full",
            pageFile: body.entryFile,
            rootDir: config.rootDir,
            route: body.route,
          })
        : (body.entryFile
          ? analyzePageFile({
              entryFile: body.entryFile,
              includeHtmlElements: body.includeHtmlElements ?? false,
              maxDepth: body.maxDepth ?? 5,
              rootDir: config.rootDir,
            })
          : analyzeRoute({
              appDir: body.appDir ?? defaultAppDir(config),
              maxDepth: body.maxDepth ?? 5,
              rootDir: config.rootDir,
              route: body.route ?? "/",
            }));

    return NextResponse.json({ graph });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
