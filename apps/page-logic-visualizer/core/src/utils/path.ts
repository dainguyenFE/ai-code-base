import { existsSync } from "node:fs";
import path from "node:path";

export const normalizePath = (filePath: string): string =>
  filePath.split(path.sep).join("/");

export const resolveFromRoot = (rootDir: string, filePath: string): string => {
  const absolute = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(rootDir, filePath);
  return normalizePath(absolute);
};

export const findTsConfigForFile = (
  rootDir: string,
  entryFile: string
): string | undefined => {
  const absoluteEntry = resolveFromRoot(rootDir, entryFile);
  let currentDir = path.dirname(absoluteEntry);

  const root = path.resolve(rootDir);
  while (currentDir.startsWith(root)) {
    const candidate = path.join(currentDir, "tsconfig.json");
    if (existsSync(candidate)) {
      return normalizePath(candidate);
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }

  const rootTsConfig = path.join(root, "tsconfig.json");
  if (existsSync(rootTsConfig)) {
    return normalizePath(rootTsConfig);
  }

  return undefined;
};

export const detectAppDir = (
  rootDir: string,
  entryFile: string
): string | undefined => {
  const normalized = resolveFromRoot(rootDir, entryFile);
  const match = normalized.match(/^(.*\/apps\/[^/]+)/);
  return match?.[1];
};

export const isReactComponentTag = (tagName: string): boolean =>
  /^[A-Z]/.test(tagName) || tagName.includes(".");

export const isHtmlElement = (tagName: string): boolean =>
  /^[a-z]/.test(tagName);
