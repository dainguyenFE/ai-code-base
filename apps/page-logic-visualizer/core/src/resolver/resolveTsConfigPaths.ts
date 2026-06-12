import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { normalizePath } from "../utils/path";

interface TsConfig {
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
}

const tsConfigCache = new Map<string, TsConfig>();

export const readTsConfig = (tsConfigPath: string): TsConfig | undefined => {
  const cached = tsConfigCache.get(tsConfigPath);
  if (cached) {
    return cached;
  }

  if (!existsSync(tsConfigPath)) {
    return undefined;
  }

  const parsed = JSON.parse(readFileSync(tsConfigPath, "utf-8")) as TsConfig;
  tsConfigCache.set(tsConfigPath, parsed);
  return parsed;
};

export const resolvePathAlias = (
  moduleSpecifier: string,
  currentFile: string,
  tsConfigPath: string
): string | undefined => {
  const tsConfig = readTsConfig(tsConfigPath);
  const paths = tsConfig?.compilerOptions?.paths;
  if (!paths) {
    return undefined;
  }

  const baseUrl = tsConfig.compilerOptions?.baseUrl
    ? path.resolve(path.dirname(tsConfigPath), tsConfig.compilerOptions.baseUrl)
    : path.dirname(tsConfigPath);

  for (const [pattern, replacements] of Object.entries(paths)) {
    const starIndex = pattern.indexOf("*");
    if (starIndex === -1) {
      if (pattern === moduleSpecifier && replacements[0]) {
        return tryResolveFile(path.resolve(baseUrl, replacements[0]));
      }
      continue;
    }

    const prefix = pattern.slice(0, starIndex);
    const suffix = pattern.slice(starIndex + 1);
    if (
      !moduleSpecifier.startsWith(prefix) ||
      !moduleSpecifier.endsWith(suffix)
    ) {
      continue;
    }

    const captured = moduleSpecifier.slice(
      prefix.length,
      moduleSpecifier.length - suffix.length
    );
    const replacement = replacements[0];
    if (!replacement) {
      continue;
    }

    const mapped = replacement.replace("*", captured);
    const resolved = path.resolve(baseUrl, mapped);
    const file = tryResolveFile(resolved);
    if (file) {
      return file;
    }
  }

  return undefined;
};

const tryResolveFile = (basePath: string): string | undefined => {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return normalizePath(candidate);
    }
  }

  return undefined;
};
