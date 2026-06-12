import { existsSync } from "node:fs";
import path from "node:path";

import type { Project, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";

import type { ImportInfo } from "../types";
import { normalizePath } from "../utils/path";
import { findImportForIdentifier } from "./analyzeImports";

const findFunctionDeclaration = (
  sourceFile: SourceFile,
  functionName: string
) => {
  const fn = sourceFile.getFunction(functionName);
  if (fn) {
    return fn;
  }

  const initializer = sourceFile
    .getVariableDeclaration(functionName)
    ?.getInitializer();

  if (
    initializer?.isKind(SyntaxKind.ArrowFunction) ||
    initializer?.isKind(SyntaxKind.FunctionExpression)
  ) {
    return initializer;
  }

  return;
};

const readReturnTypeAnnotation = (
  fnNode: import("ts-morph").Node
): string | undefined => {
  if (fnNode.isKind(SyntaxKind.FunctionDeclaration)) {
    return fnNode.getReturnTypeNode()?.getText();
  }
  if (
    fnNode.isKind(SyntaxKind.ArrowFunction) ||
    fnNode.isKind(SyntaxKind.FunctionExpression)
  ) {
    return fnNode.getReturnTypeNode()?.getText();
  }
  return undefined;
};

const tryResolveRelativeModule = (
  moduleSpecifier: string,
  fromFilePath: string
): string | undefined => {
  const base = path.resolve(path.dirname(fromFilePath), moduleSpecifier);
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

const loadSourceFile = (
  project: Project,
  filePath: string
): SourceFile | undefined =>
  project.getSourceFile(filePath) ??
  project.addSourceFileAtPathIfExists(filePath);

const readReturnTypeFromFunctionNode = (
  fnNode: import("ts-morph").Node,
  project?: Project
): string | undefined => {
  const annotated = readReturnTypeAnnotation(fnNode);
  if (annotated) {
    return annotated;
  }

  if (!project) {
    return undefined;
  }

  try {
    if (fnNode.isKind(SyntaxKind.FunctionDeclaration)) {
      return fnNode.getReturnType().getText();
    }
    if (
      fnNode.isKind(SyntaxKind.ArrowFunction) ||
      fnNode.isKind(SyntaxKind.FunctionExpression)
    ) {
      return fnNode.getReturnType().getText();
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const readReturnTypeFromSourceFile = ({
  functionName,
  project,
  sourceFile,
  visited,
}: {
  functionName: string;
  project?: Project;
  sourceFile: SourceFile;
  visited: Set<string>;
}): string | undefined => {
  const filePath = sourceFile.getFilePath();
  if (visited.has(filePath)) {
    return undefined;
  }
  visited.add(filePath);

  const fnNode = findFunctionDeclaration(sourceFile, functionName);
  if (fnNode) {
    return readReturnTypeFromFunctionNode(fnNode, project);
  }

  if (!project) {
    return undefined;
  }

  for (const exportDecl of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (!moduleSpecifier) {
      continue;
    }

    const namedExports = exportDecl.getNamedExports();
    if (
      namedExports.length > 0 &&
      !namedExports.some((item) => item.getName() === functionName)
    ) {
      continue;
    }

    const resolvedPath = tryResolveRelativeModule(moduleSpecifier, filePath);
    if (!resolvedPath) {
      continue;
    }

    const reExportedFile = loadSourceFile(project, resolvedPath);
    if (!reExportedFile) {
      continue;
    }

    const returnType = readReturnTypeFromSourceFile({
      functionName,
      project,
      sourceFile: reExportedFile,
      visited,
    });
    if (returnType) {
      return returnType;
    }
  }

  return undefined;
};

const findFunctionLocInSourceFile = ({
  functionName,
  project,
  sourceFile,
  visited,
}: {
  functionName: string;
  project?: Project;
  sourceFile: SourceFile;
  visited: Set<string>;
}): SourceLocation | undefined => {
  const filePath = sourceFile.getFilePath();
  if (visited.has(filePath)) {
    return undefined;
  }
  visited.add(filePath);

  const fnNode = findFunctionDeclaration(sourceFile, functionName);
  if (fnNode) {
    return getSourceLocation(fnNode, normalizePath(filePath));
  }

  if (!project) {
    return undefined;
  }

  for (const exportDecl of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (!moduleSpecifier) {
      continue;
    }

    const namedExports = exportDecl.getNamedExports();
    if (
      namedExports.length > 0 &&
      !namedExports.some((item) => item.getName() === functionName)
    ) {
      continue;
    }

    const resolvedPath = tryResolveRelativeModule(moduleSpecifier, filePath);
    if (!resolvedPath) {
      continue;
    }

    const reExportedFile = loadSourceFile(project, resolvedPath);
    if (!reExportedFile) {
      continue;
    }

    const loc = findFunctionLocInSourceFile({
      functionName,
      project,
      sourceFile: reExportedFile,
      visited,
    });
    if (loc) {
      return loc;
    }
  }

  return undefined;
};

export const resolveFunctionDefinitionLoc = ({
  functionName,
  imports,
  project,
  sourceFile,
  resolvedFilePath,
}: {
  functionName: string;
  imports: ImportInfo[];
  project?: Project;
  sourceFile?: SourceFile;
  resolvedFilePath?: string;
}): SourceLocation | undefined => {
  const filesToTry: SourceFile[] = [];
  const seenPaths = new Set<string>();

  const pushFile = (file: SourceFile | undefined) => {
    if (!file) {
      return;
    }
    const filePath = file.getFilePath();
    if (seenPaths.has(filePath)) {
      return;
    }
    seenPaths.add(filePath);
    filesToTry.push(file);
  };

  if (resolvedFilePath && project) {
    pushFile(loadSourceFile(project, resolvedFilePath));
  }

  const importInfo = findImportForIdentifier(imports, functionName);
  if (importInfo?.resolvedPath && project) {
    pushFile(loadSourceFile(project, importInfo.resolvedPath));
  }

  pushFile(sourceFile);

  const visited = new Set<string>();
  for (const file of filesToTry) {
    const loc = findFunctionLocInSourceFile({
      functionName,
      project,
      sourceFile: file,
      visited,
    });
    if (loc) {
      return loc;
    }
  }

  return undefined;
};

export const resolveFunctionReturnType = ({
  functionName,
  imports,
  project,
  sourceFile,
  resolvedFilePath,
}: {
  functionName: string;
  imports: ImportInfo[];
  project?: Project;
  sourceFile?: SourceFile;
  resolvedFilePath?: string;
}): string | undefined => {
  const filesToTry: SourceFile[] = [];
  const seenPaths = new Set<string>();

  const pushFile = (file: SourceFile | undefined) => {
    if (!file) {
      return;
    }
    const filePath = file.getFilePath();
    if (seenPaths.has(filePath)) {
      return;
    }
    seenPaths.add(filePath);
    filesToTry.push(file);
  };

  if (resolvedFilePath && project) {
    pushFile(loadSourceFile(project, resolvedFilePath));
  }

  const importInfo = findImportForIdentifier(imports, functionName);
  if (importInfo?.resolvedPath && project) {
    pushFile(loadSourceFile(project, importInfo.resolvedPath));
  }

  pushFile(sourceFile);

  const visited = new Set<string>();
  for (const file of filesToTry) {
    const returnType = readReturnTypeFromSourceFile({
      functionName,
      project,
      sourceFile: file,
      visited,
    });
    if (returnType) {
      return returnType;
    }
  }

  return undefined;
};
