import {
  Node,
  Project,
  type ArrowFunction,
  type FunctionDeclaration,
  type ParameterDeclaration,
  type SourceFile,
  type VariableDeclaration,
} from "ts-morph";
import type {
  ImportInfo,
  ParsedFile,
  ScannedFile,
  SymbolInfo,
  SymbolType,
} from "@ai-trace/types";
import {
  hashText,
  isHookName,
  isJsxFile,
  isPascalCase,
  makeSymbolId,
} from "./utils.js";

function collectImports(sourceFile: SourceFile): ImportInfo[] {
  return sourceFile.getImportDeclarations().map((decl) => ({
    source: decl.getModuleSpecifierValue(),
    named: decl.getNamedImports().map((item) => item.getName()),
    defaultImport: decl.getDefaultImport()?.getText(),
    isTypeOnly: decl.isTypeOnly(),
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

function getFunctionBody(node: FunctionDeclaration | ArrowFunction | VariableDeclaration): string {
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
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
      params = init.getParameters();
    }
  }

  if (params.length === 0) return [];

  const first = params[0];
  if (!first) return [];

  const nameNode = first.getNameNode();
  if (Node.isObjectBindingPattern(nameNode)) {
    return nameNode
      .getElements()
      .map((el) => el.getName())
      .filter(Boolean);
  }

  return [first.getName()];
}

function collectCalls(node: Node): string[] {
  const calls = new Set<string>();

  node.forEachDescendant((child) => {
    if (Node.isCallExpression(child)) {
      const expr = child.getExpression();
      if (Node.isIdentifier(expr)) {
        calls.add(expr.getText());
      }
    }
  });

  return [...calls];
}

function collectRenders(node: Node): string[] {
  const renders = new Set<string>();

  node.forEachDescendant((child) => {
    if (Node.isJsxOpeningElement(child) || Node.isJsxSelfClosingElement(child)) {
      const tag = child.getTagNameNode().getText();
      if (isPascalCase(tag)) {
        renders.add(tag);
      }
    }
  });

  return [...renders];
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
  if (isHookName(name)) return "hook";
  if (isJsxFile(filePath) && isPascalCase(name) && hasJsxReturn(body)) {
    return "component";
  }
  if (name.startsWith("get") || name.startsWith("fetch")) return "service";
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

  return {
    id: makeSymbolId(type, name),
    name,
    type,
    filePath,
    startLine,
    endLine,
    signature: bodyText.split("\n")[0]?.slice(0, 120),
    props: type === "component" ? extractProps(bodyNode as never) : undefined,
    calls: collectCalls(bodyNode),
    renders: type === "component" ? collectRenders(bodyNode) : undefined,
    usesHooks: collectHookUsage(bodyNode),
    hash: hashText(bodyText),
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
  if (!init) return;

  if (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) {
    return;
  }

  const type = classifySymbol(name, init, filePath);
  symbols.push(
    buildSymbol(
      name,
      type,
      filePath,
      init,
      decl.getStartLineNumber(),
      decl.getEndLineNumber()
    )
  );
}

export function parseFile(file: ScannedFile): ParsedFile {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      jsx: 4,
      allowJs: true,
      target: 99,
    },
  });

  const sourceFile = project.createSourceFile(file.path, file.content, {
    overwrite: true,
  });

  const content = file.content;
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
        name,
        isDefault: name === "default",
        isTypeOnly:
          Node.isTypeAliasDeclaration(decl) ||
          Node.isInterfaceDeclaration(decl),
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
    if (!name || symbols.some((s) => s.name === name)) continue;
    parseFunctionLike(name, fn, file.path, symbols);
  }

  for (const statement of sourceFile.getVariableStatements()) {
    for (const decl of statement.getDeclarations()) {
      const name = decl.getName();
      if (symbols.some((s) => s.name === name)) continue;
      parseVariable(decl, file.path, symbols);
    }
  }

  for (const symbol of symbols) {
    symbol.isClientComponent = isClientComponent;
    symbol.isServerComponent = isServerComponent;
  }

  return {
    filePath: file.path,
    imports,
    exports,
    symbols,
    isClientComponent,
    isServerComponent,
  };
}

export function parseFiles(files: ScannedFile[]): ParsedFile[] {
  return files.map(parseFile);
}
