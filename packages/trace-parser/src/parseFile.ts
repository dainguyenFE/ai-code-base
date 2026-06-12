import type {
  ImportInfo,
  ParsedFile,
  ScannedFile,
  SymbolInfo,
  SymbolType,
} from "@ai-trace/types";
import { Node, Project } from "ts-morph";
import type {
  ArrowFunction,
  FunctionDeclaration,
  ParameterDeclaration,
  SourceFile,
  VariableDeclaration,
} from "ts-morph";

import { collectCallSites, collectPropFlows } from "./collectDataFlow.js";
import {
  buildExecutionSteps,
  collectRenderSites,
  collectRendersFromSites,
} from "./collectExecutionSteps.js";
import {
  collectDynamicImports,
  collectPassedProps,
} from "./collectJsxMetadata.js";
import {
  hashText,
  isHookName,
  isJsxFile,
  isPascalCase,
  makeSymbolId,
} from "./utils.js";

function collectImports(sourceFile: SourceFile): ImportInfo[] {
  return sourceFile.getImportDeclarations().map((decl) => ({
    defaultImport: decl.getDefaultImport()?.getText(),
    isTypeOnly: decl.isTypeOnly(),
    named: decl.getNamedImports().map((item) => item.getName()),
    source: decl.getModuleSpecifierValue(),
  }));
}

function collectExports(sourceFile: SourceFile) {
  return sourceFile.getExportedDeclarations();
}

function hasJsxReturn(node: Node): boolean {
  if (Node.isJsxElement(node) || Node.isJsxSelfClosingElement(node)) {
    return true;
  }

  for (const child of node.getDescendants()) {
    if (
      Node.isJsxElement(child) ||
      Node.isJsxSelfClosingElement(child) ||
      Node.isJsxFragment(child)
    ) {
      return true;
    }
  }

  return false;
}

function getFunctionBody(
  node: FunctionDeclaration | ArrowFunction | VariableDeclaration
): string {
  if (Node.isVariableDeclaration(node)) {
    const init = node.getInitializer();
    return init?.getText() ?? node.getText();
  }
  return node.getText();
}

function extractProps(
  node: FunctionDeclaration | ArrowFunction | VariableDeclaration
): string[] {
  let params: ParameterDeclaration[] = [];

  if (Node.isFunctionDeclaration(node) || Node.isArrowFunction(node)) {
    params = node.getParameters();
  } else if (Node.isVariableDeclaration(node)) {
    const init = node.getInitializer();
    if (
      init &&
      (Node.isArrowFunction(init) || Node.isFunctionExpression(init))
    ) {
      params = init.getParameters();
    }
  }

  if (params.length === 0) {
    return [];
  }

  const first = params[0];
  if (!first) {
    return [];
  }

  const nameNode = first.getNameNode();
  if (Node.isObjectBindingPattern(nameNode)) {
    return nameNode
      .getElements()
      .map((el) => el.getName())
      .filter(Boolean);
  }

  return [first.getName()];
}

function calleeName(expr: Node): string | null {
  if (Node.isIdentifier(expr)) {
    return expr.getText();
  }

  if (Node.isPropertyAccessExpression(expr)) {
    const object = expr.getExpression().getText();
    const property = expr.getName();
    return `${object}.${property}`;
  }

  return null;
}

function collectCalls(node: Node): string[] {
  const calls = new Set<string>();

  for (const site of collectCallSites(node)) {
    calls.add(site.callee);
    const root = site.callee.split(".")[0];
    if (root) {
      calls.add(root);
    }
  }

  return [...calls];
}

function collectHookUsage(node: Node): string[] {
  const hooks = new Set<string>();

  node.forEachDescendant((child) => {
    if (Node.isCallExpression(child)) {
      const expr = child.getExpression();
      if (Node.isIdentifier(expr) && isHookName(expr.getText())) {
        hooks.add(expr.getText());
      }
    }
  });

  return [...hooks];
}

function classifySymbol(
  name: string,
  body: Node,
  filePath: string
): SymbolType {
  if (isHookName(name)) {
    return "hook";
  }
  if (isJsxFile(filePath) && isPascalCase(name) && hasJsxReturn(body)) {
    return "component";
  }
  if (name.startsWith("get") || name.startsWith("fetch")) {
    return "service";
  }
  return "function";
}

function buildSymbol(
  name: string,
  type: SymbolType,
  filePath: string,
  bodyNode: Node,
  startLine: number,
  endLine: number
): SymbolInfo {
  const bodyText = bodyNode.getText();

  const callSites = collectCallSites(bodyNode);
  const renderSites = collectRenderSites(bodyNode);
  const executionSteps = buildExecutionSteps(bodyNode);

  return {
    callSites,
    calls: collectCalls(bodyNode),
    dynamicImports: collectDynamicImports(bodyNode),
    endLine,
    executionSteps: executionSteps.length > 0 ? executionSteps : undefined,
    filePath,
    hash: hashText(bodyText),
    id: makeSymbolId(type, name, filePath),
    name,
    passedProps:
      type === "component" ? collectPassedProps(bodyNode) : undefined,
    propFlows: type === "component" ? collectPropFlows(bodyNode) : undefined,
    props: type === "component" ? extractProps(bodyNode as never) : undefined,
    renderSites: renderSites.length > 0 ? renderSites : undefined,
    renders:
      renderSites.length > 0 ? collectRendersFromSites(renderSites) : undefined,
    signature: bodyText.split("\n")[0]?.slice(0, 120),
    startLine,
    type,
    usesHooks: collectHookUsage(bodyNode),
  };
}

function parseFunctionLike(
  name: string,
  node: FunctionDeclaration | ArrowFunction,
  filePath: string,
  symbols: SymbolInfo[]
) {
  const type = classifySymbol(name, node, filePath);
  symbols.push(
    buildSymbol(
      name,
      type,
      filePath,
      node,
      node.getStartLineNumber(),
      node.getEndLineNumber()
    )
  );
}

function parseVariable(
  decl: VariableDeclaration,
  filePath: string,
  symbols: SymbolInfo[]
) {
  const name = decl.getName();
  const init = decl.getInitializer();
  if (!init) {
    return;
  }

  let bodyNode: Node;
  let type: SymbolType;

  if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
    bodyNode = init;
    type = classifySymbol(name, init, filePath);
  } else if (Node.isCallExpression(init)) {
    bodyNode = init;
    type = "function";
  } else {
    return;
  }

  symbols.push(
    buildSymbol(
      name,
      type,
      filePath,
      bodyNode,
      decl.getStartLineNumber(),
      decl.getEndLineNumber()
    )
  );
}

export function parseFile(file: ScannedFile): ParsedFile {
  const project = new Project({
    compilerOptions: {
      allowJs: true,
      jsx: 4,
      target: 99,
    },
    useInMemoryFileSystem: true,
  });

  const sourceFile = project.createSourceFile(file.path, file.content, {
    overwrite: true,
  });

  const { content } = file;
  const isClientComponent =
    content.includes('"use client"') || content.includes("'use client'");
  const isServerComponent =
    content.includes('"use server"') || content.includes("'use server'");

  const imports = collectImports(sourceFile);
  const exports: ParsedFile["exports"] = [];
  const symbols: SymbolInfo[] = [];

  for (const [name, declarations] of collectExports(sourceFile)) {
    for (const decl of declarations) {
      exports.push({
        isDefault: name === "default",
        isTypeOnly:
          Node.isTypeAliasDeclaration(decl) ||
          Node.isInterfaceDeclaration(decl),
        name,
      });

      if (Node.isFunctionDeclaration(decl) && decl.getName()) {
        parseFunctionLike(decl.getName()!, decl, file.path, symbols);
      } else if (Node.isVariableDeclaration(decl)) {
        parseVariable(decl, file.path, symbols);
      }
    }
  }

  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name || symbols.some((s) => s.name === name)) {
      continue;
    }
    parseFunctionLike(name, fn, file.path, symbols);
  }

  for (const statement of sourceFile.getVariableStatements()) {
    for (const decl of statement.getDeclarations()) {
      const name = decl.getName();
      if (symbols.some((s) => s.name === name)) {
        continue;
      }
      parseVariable(decl, file.path, symbols);
    }
  }

  const fileLevelDynamicImports = collectDynamicImports(sourceFile);
  const defaultExportNames = new Set(
    exports.filter((item) => item.isDefault).map((item) => item.name)
  );

  for (const symbol of symbols) {
    symbol.isClientComponent = isClientComponent;
    symbol.isServerComponent = isServerComponent;

    const isDefaultExportComponent =
      symbol.type === "component" &&
      (defaultExportNames.has(symbol.name) ||
        defaultExportNames.has("default"));

    if (!isDefaultExportComponent || fileLevelDynamicImports.length === 0) {
      continue;
    }

    const existingLines = new Set(
      (symbol.dynamicImports ?? []).map((item) => item.line)
    );
    const merged = fileLevelDynamicImports.filter(
      (item) => !existingLines.has(item.line)
    );

    if (merged.length > 0) {
      symbol.dynamicImports = [...(symbol.dynamicImports ?? []), ...merged];
    }
  }

  return {
    exports,
    filePath: file.path,
    imports,
    isClientComponent,
    isServerComponent,
    symbols,
  };
}

export function parseFiles(files: ScannedFile[]): ParsedFile[] {
  return files.map(parseFile);
}
