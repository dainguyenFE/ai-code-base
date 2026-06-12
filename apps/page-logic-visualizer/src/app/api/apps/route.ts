import { listProjectApps } from "@cs/page-logic-visualizer/server";
import { NextResponse } from "next/server";

import { getServerProjectConfig } from "@/lib/server-project-config";

export async function GET() {
  const config = await getServerProjectConfig();
  const apps = listProjectApps(config);

  return NextResponse.json({
    apps: apps.toSorted(),
    projectType: config.projectType,
    rootDir: config.rootDir,
  });
}
