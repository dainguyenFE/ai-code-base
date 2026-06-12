import { existsSync } from "node:fs";
import path from "node:path";

import { defaultAppDir, listAppRoutes } from "@cs/page-logic-visualizer/server";
import { NextResponse } from "next/server";

import { getServerProjectConfig } from "@/lib/server-project-config";

export async function GET(request: Request) {
  const config = await getServerProjectConfig();
  const { searchParams } = new URL(request.url);
  const appDir = searchParams.get("appDir") || defaultAppDir(config);

  const absoluteAppDir = path.resolve(config.rootDir, appDir);
  if (!existsSync(absoluteAppDir)) {
    return NextResponse.json(
      { error: `App directory not found: ${appDir}` },
      { status: 404 }
    );
  }

  const routes = listAppRoutes(appDir, config.rootDir);
  return NextResponse.json({ appDir, rootDir: config.rootDir, routes });
}
