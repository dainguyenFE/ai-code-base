import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { listSubdirectories } from "../utils/fs";
import { normalizePath } from "../utils/path";

interface PackageJson {
  name?: string;
  exports?: Record<string, string | { import?: string; default?: string }>;
  main?: string;
}

const packageCache = new Map<string, PackageJson>();

const readPackageJson = (packageDir: string): PackageJson | undefined => {
  const cached = packageCache.get(packageDir);
  if (cached) {
    return cached;
  }

  const packageJsonPath = path.join(packageDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }

  const parsed = JSON.parse(
    readFileSync(packageJsonPath, "utf-8")
  ) as PackageJson;
  packageCache.set(packageDir, parsed);
  return parsed;
};

const resolveExportTarget = (
  target: string | { import?: string; default?: string } | undefined
): string | undefined => {
  if (!target) {
    return undefined;
  }
  if (typeof target === "string") {
    return target;
  }
  return target.import ?? target.default;
};

export const findWorkspacePackageDir = (
  rootDir: string,
  packageName: string
): string | undefined => {
  const packagesDir = path.join(rootDir, "packages");
  if (!existsSync(packagesDir)) {
    return undefined;
  }

  for (const entry of listSubdirectories(packagesDir)) {
    const packageDir = path.join(packagesDir, entry);
    const pkg = readPackageJson(packageDir);
    if (pkg?.name === packageName) {
      return normalizePath(packageDir);
    }
  }

  return undefined;
};

export const resolvePackageSubpath = (
  packageDir: string,
  subpath: string
): string | undefined => {
  const pkg = readPackageJson(packageDir);
  if (!pkg) {
    return undefined;
  }

  const exportKey = subpath === "." ? "." : `./${subpath}`;
  const { exports } = pkg;

  if (exports) {
    const target = resolveExportTarget(exports[exportKey]);
    if (target) {
      const resolved = path.join(packageDir, target);
      if (existsSync(resolved)) {
        return normalizePath(resolved);
      }
    }
  }

  const candidates = [
    path.join(packageDir, "src", "components", `${subpath}.tsx`),
    path.join(packageDir, "src", "components", `${subpath}.ts`),
    path.join(packageDir, "src", `${subpath}.tsx`),
    path.join(packageDir, "src", `${subpath}.ts`),
    path.join(packageDir, `${subpath}.tsx`),
    path.join(packageDir, `${subpath}.ts`),
    path.join(packageDir, subpath, "index.tsx"),
    path.join(packageDir, subpath, "index.ts"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return normalizePath(candidate);
    }
  }

  if (pkg.main && existsSync(path.join(packageDir, pkg.main))) {
    return normalizePath(path.join(packageDir, pkg.main));
  }

  return undefined;
};
