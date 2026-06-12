import path from "node:path";

const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

export function resolveRelativeModule(
  fromFile: string,
  specifier: string,
  knownPaths: Set<string>
): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const fromDir = path.posix.dirname(fromFile.replaceAll("\\", "/"));
  const joined = path.posix.normalize(path.posix.join(fromDir, specifier));

  const candidates = [
    joined,
    ...EXTENSIONS.map((ext) => `${joined}${ext}`),
    ...EXTENSIONS.map((ext) => `${joined}/index${ext}`),
  ];

  for (const candidate of candidates) {
    if (knownPaths.has(candidate)) {
      return candidate;
    }
  }

  return null;
}
