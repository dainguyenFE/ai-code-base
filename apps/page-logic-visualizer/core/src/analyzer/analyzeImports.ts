import type { SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";

import { resolveImport } from "../resolver/resolveImport";
import type { ImportInfo } from "../types";

export interface AnalyzeImportsOptions {
  sourceFile: SourceFile;
  filePath: string;
  rootDir: string;
  tsConfigPath?: string;
}

export const analyzeImports = ({
  sourceFile,
  filePath,
  rootDir,
  tsConfigPath,
}: AnalyzeImportsOptions): ImportInfo[] => {
  const imports: ImportInfo[] = [];

  for (const declaration of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = declaration.getModuleSpecifierValue();
    const namedImports = declaration
      .getNamedImports()
      .map((named) => named.getName());
    const defaultImport = declaration.getDefaultImport()?.getText();
    const isTypeOnly = declaration.isTypeOnly();

    const { resolvedPath, packageName } = resolveImport({
      currentFile: filePath,
      moduleSpecifier,
      rootDir,
      tsConfigPath,
    });

    imports.push({
      defaultImport,
      isTypeOnly,
      moduleSpecifier,
      namedImports,
      packageName,
      resolvedPath,
      specifier: moduleSpecifier,
    });
  }

  for (const declaration of sourceFile.getExportDeclarations()) {
    if (!declaration.getModuleSpecifierValue()) {
      continue;
    }
    const moduleSpecifier = declaration.getModuleSpecifierValue()!;
    const namedImports = declaration
      .getNamedExports()
      .map((named) => named.getName());

    const { resolvedPath, packageName } = resolveImport({
      currentFile: filePath,
      moduleSpecifier,
      rootDir,
      tsConfigPath,
    });

    imports.push({
      isTypeOnly: declaration.isTypeOnly(),
      moduleSpecifier,
      namedImports,
      packageName,
      resolvedPath,
      specifier: moduleSpecifier,
    });
  }

  // Filter out type-only imports without named/default
  return imports.filter((info) => {
    if (!info.isTypeOnly) {
      return true;
    }
    return info.namedImports.length > 0 || Boolean(info.defaultImport);
  });
};

export const findImportForIdentifier = (
  imports: ImportInfo[],
  identifier: string
): ImportInfo | undefined =>
  imports.find(
    (info) =>
      info.defaultImport === identifier ||
      info.namedImports.includes(identifier)
  );
