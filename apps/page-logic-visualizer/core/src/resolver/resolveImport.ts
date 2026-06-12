import { existsSync } from "node:fs";
import path from "node:path";

import { normalizePath } from "../utils/path";
import {
  findWorkspacePackageDir,
  resolvePackageSubpath,
} from "./resolvePackageSource";
import { resolvePathAlias } from "./resolveTsConfigPaths";

export interface ResolveImportOptions {
  moduleSpecifier: string;
  currentFile: string;
  rootDir: string;
  tsConfigPath?: string;
}

export const resolveImport = ({
  moduleSpecifier,
  currentFile,
  rootDir,
  tsConfigPath,
}: ResolveImportOptions): {
  resolvedPath?: string;
  packageName?: string;
} => {
  const absoluteCurrent = path.isAbsolute(currentFile)
    ? currentFile
    : path.resolve(rootDir, currentFile);

  if (moduleSpecifier.startsWith(".")) {
    const resolved = tryResolveRelative(moduleSpecifier, absoluteCurrent);
    return { resolvedPath: resolved };
  }

  if (moduleSpecifier.startsWith("@/") && tsConfigPath) {
    const aliasResolved = resolvePathAlias(
      moduleSpecifier,
      absoluteCurrent,
      tsConfigPath
    );
    if (aliasResolved) {
      return { resolvedPath: aliasResolved };
    }
  }

  const workspaceMatch = moduleSpecifier.match(
    /^(@[^/]+(?:\/[^/]+)?)(?:\/(.*))?$/
  );
  if (workspaceMatch) {
    const packageName = workspaceMatch[1]!;
    const subpath = workspaceMatch[2] ?? ".";
    const packageDir = findWorkspacePackageDir(rootDir, packageName);
    if (packageDir) {
      const resolved = resolvePackageSubpath(packageDir, subpath);
      return { packageName, resolvedPath: resolved };
    }
  }

  if (tsConfigPath) {
    const aliasResolved = resolvePathAlias(
      moduleSpecifier,
      absoluteCurrent,
      tsConfigPath
    );
    if (aliasResolved) {
      return { resolvedPath: aliasResolved };
    }
  }

  return {};
};

/** Only warn when the import should resolve inside the monorepo (not npm externals). */
export const shouldWarnUnresolvedImport = (
  moduleSpecifier: string,
  rootDir: string,
  packageName?: string
): boolean => {
  if (moduleSpecifier.startsWith(".")) {
    return true;
  }

  if (moduleSpecifier.startsWith("@/")) {
    return true;
  }

  if (packageName) {
    return true;
  }

  const scoped = moduleSpecifier.match(/^(@[^/]+(?:\/[^/]+)?)(?:\/|$)/);
  if (scoped) {
    return Boolean(findWorkspacePackageDir(rootDir, scoped[1]!));
  }

  return false;
};

const tryResolveRelative = (
  moduleSpecifier: string,
  currentFile: string
): string | undefined => {
  const base = path.resolve(path.dirname(currentFile), moduleSpecifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return normalizePath(candidate);
    }
  }

  return undefined;
};
