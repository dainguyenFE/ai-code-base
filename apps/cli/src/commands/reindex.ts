import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { runClean } from "./clean.js";
import { runIndex } from "./index-project.js";

const AGENT_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** Packages required before `index` reads compiled parser/graph output. */
const INDEX_BUILD_PACKAGES = [
  "packages/trace-types",
  "packages/trace-config",
  "packages/trace-scanner",
  "packages/trace-parser",
  "packages/trace-graph",
  "packages/trace-cache",
];

async function buildPackage(relativePath: string): Promise<void> {
  const pkgDir = path.join(AGENT_ROOT, relativePath);
  console.log(`Building ${relativePath}...`);

  const result = await Bun.$`bun run build`.cwd(pkgDir).nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`Build failed: ${relativePath}`);
  }
}

function newestMtimeInDir(dir: string): number {
  let max = 0;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      max = Math.max(max, newestMtimeInDir(fullPath));
      continue;
    }

    try {
      max = Math.max(max, statSync(fullPath).mtimeMs);
    } catch {
      continue;
    }
  }

  return max;
}

function isSourceNewerThanDist(packagePath: string): boolean {
  const srcDir = path.join(AGENT_ROOT, packagePath, "src");
  const distEntry = path.join(AGENT_ROOT, packagePath, "dist", "index.js");

  let distMtime = 0;
  try {
    distMtime = statSync(distEntry).mtimeMs;
  } catch {
    return true;
  }

  return newestMtimeInDir(srcDir) > distMtime;
}

function needsBuild(): boolean {
  return INDEX_BUILD_PACKAGES.some((pkg) => isSourceNewerThanDist(pkg));
}

export interface ReindexOptions {
  build?: boolean;
  clean?: boolean;
  forceBuild?: boolean;
}

export async function runReindex(
  cwd: string,
  options: ReindexOptions = {}
): Promise<void> {
  const shouldBuild = options.build !== false;
  const shouldClean = options.clean !== false;
  const forceBuild = options.forceBuild === true;

  if (shouldBuild && (forceBuild || needsBuild())) {
    console.log("Building trace packages...");
    for (const pkg of INDEX_BUILD_PACKAGES) {
      await buildPackage(pkg);
    }
    console.log("Build complete.\n");
  } else if (shouldBuild) {
    console.log("Trace packages up to date — skipping build.\n");
  }

  if (shouldClean) {
    console.log("Clearing SQLite cache...");
    await runClean(cwd, { cache: true });
    console.log("");
  }

  await runIndex(cwd);
}
