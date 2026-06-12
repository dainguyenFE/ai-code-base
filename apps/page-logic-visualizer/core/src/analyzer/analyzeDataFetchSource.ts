import type { CallExpression, Project, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";

import { resolveImport } from "../resolver/resolveImport";
import type { DataFetchMeta, ImportInfo } from "../types";
import { getNodeText } from "../utils/ast";
import { analyzeImports, findImportForIdentifier } from "./analyzeImports";

export interface ApiCallMeta {
  method: string;
  url: string;
  body?: string;
}

export interface DataFetchSourceAnalysis {
  internalCalls: string[];
  nestedFunctionCalls: NestedFunctionCallMeta[];
  apiCalls: ApiCallMeta[];
  promiseAllLabel?: string;
  returnFieldLiterals: Record<string, ReturnFieldLiteralMeta>;
  resolvedFilePath?: string;
}

const analysisCache = new Map<string, DataFetchSourceAnalysis>();

const BUILTIN_CALLS = new Set([
  "fetch",
  "Promise",
  "JSON",
  "Object",
  "Array",
  "console",
  "setTimeout",
  "setInterval",
  "Math",
  "Date",
  "Error",
]);

const literalValueText = (
  node: import("ts-morph").Node
): string | undefined => {
  if (
    node.isKind(SyntaxKind.TrueKeyword) ||
    node.isKind(SyntaxKind.FalseKeyword) ||
    node.isKind(SyntaxKind.NullKeyword)
  ) {
    return node.getText();
  }
  if (node.isKind(SyntaxKind.StringLiteral)) {
    return JSON.stringify(node.getLiteralValue());
  }
  if (node.isKind(SyntaxKind.NumericLiteral)) {
    return node.getText();
  }
  return undefined;
};

const flattenObjectLiterals = (
  node: import("ts-morph").Node,
  filePath: string,
  prefix = ""
): Record<string, ReturnFieldLiteralMeta> => {
  const result: Record<string, ReturnFieldLiteralMeta> = {};

  if (!node.isKind(SyntaxKind.ObjectLiteralExpression)) {
    const literal = literalValueText(node);
    if (literal !== undefined && prefix) {
      result[prefix] = {
        loc: getSourceLocation(node, filePath),
        value: literal,
      };
    }
    return result;
  }

  for (const property of node.getProperties()) {
    if (!property.isKind(SyntaxKind.PropertyAssignment)) {
      continue;
    }
    const nameNode = property.getNameNode();
    const key = nameNode.getText().replaceAll(/^["']|["']$/g, "");
    const path = prefix ? `${prefix}.${key}` : key;
    const initializer = property.getInitializer();
    if (!initializer) {
      continue;
    }

    const literal = literalValueText(initializer);
    if (literal !== undefined) {
      result[path] = {
        loc: getSourceLocation(property, filePath),
        value: literal,
      };
      continue;
    }

    if (initializer.isKind(SyntaxKind.ObjectLiteralExpression)) {
      Object.assign(result, flattenObjectLiterals(initializer, filePath, path));
    }
  }

  return result;
};

/** Collect literal fields from every `return { ... }` in the function body (incl. try/catch). */
const collectReturnFieldLiteralsFromBody = (
  body: import("ts-morph").Node | undefined,
  filePath: string
): Record<string, ReturnFieldLiteralMeta> => {
  if (!body) {
    return {};
  }

  const merged: Record<string, ReturnFieldLiteralMeta> = {};
  body.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.ReturnStatement)) {
      return;
    }
    const argument = node.getExpression();
    if (!argument) {
      return;
    }
    Object.assign(merged, flattenObjectLiterals(argument, filePath));
  });
  return merged;
};

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

const getFunctionBody = (fnNode: import("ts-morph").Node) => {
  if (fnNode.isKind(SyntaxKind.FunctionDeclaration)) {
    return fnNode.getBody();
  }
  if (
    fnNode.isKind(SyntaxKind.ArrowFunction) ||
    fnNode.isKind(SyntaxKind.FunctionExpression)
  ) {
    return fnNode.getBody();
  }
  return;
};

const extractFetchCall = (
  call: CallExpression,
  filePath: string
): ApiCallMeta | undefined => {
  const expression = call.getExpression();
  const isFetch =
    (expression.isKind(SyntaxKind.Identifier) &&
      expression.getText() === "fetch") ||
    getNodeText(expression) === "fetch";

  if (!isFetch) {
    return undefined;
  }

  const urlArg = call.getArguments()[0];
  const optionsArg = call.getArguments()[1];
  const url = urlArg?.isKind(SyntaxKind.StringLiteral)
    ? urlArg.getLiteralValue()
    : (urlArg
      ? getNodeText(urlArg)
      : "unknown");

  let method = "GET";
  let body: string | undefined;

  if (optionsArg?.isKind(SyntaxKind.ObjectLiteralExpression)) {
    for (const property of optionsArg.getProperties()) {
      if (!property.isKind(SyntaxKind.PropertyAssignment)) {
        continue;
      }
      const key = property.getName();
      const init = property.getInitializer();
      if (!init) {
        continue;
      }
      if (key === "method") {
        method = init.getText().replaceAll(/["']/g, "").toUpperCase();
      }
      if (key === "body") {
        body = getNodeText(init);
      }
    }
  }

  return { body, method, url };
};

const collectApiCalls = (
  body: import("ts-morph").Node | undefined
): ApiCallMeta[] => {
  if (!body) {
    return [];
  }

  const calls: ApiCallMeta[] = [];
  body.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.CallExpression)) {
      return;
    }
    const fetchCall = extractFetchCall(node as CallExpression);
    if (fetchCall) {
      calls.push(fetchCall);
    }
  });
  return calls;
};

const collectPromiseAllLabel = (
  body: import("ts-morph").Node | undefined
): string | undefined => {
  if (!body) {
    return undefined;
  }

  let label: string | undefined;
  body.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.CallExpression) || label) {
      return;
    }
    const call = node as CallExpression;
    const expression = call.getExpression();
    if (
      !expression.isKind(SyntaxKind.PropertyAccessExpression) ||
      expression.getName() !== "all"
    ) {
      return;
    }
    const args = call.getArguments()[0];
    if (!args?.isKind(SyntaxKind.ArrayLiteralExpression)) {
      return;
    }
    const names = args
      .getElements()
      .map((element) => getNodeText(element))
      .filter(Boolean);
    if (names.length > 0) {
      label = `Promise.all(${names.join(", ")})`;
    }
  });
  return label;
};

const isFunctionAsync = (
  sourceFile: SourceFile | undefined,
  functionName: string
): boolean => {
  if (!sourceFile) {
    return false;
  }
  const fnNode = findFunctionDeclaration(sourceFile, functionName);
  if (!fnNode) {
    return false;
  }
  if (fnNode.isKind(SyntaxKind.FunctionDeclaration)) {
    return fnNode.isAsync();
  }
  if (
    fnNode.isKind(SyntaxKind.ArrowFunction) ||
    fnNode.isKind(SyntaxKind.FunctionExpression)
  ) {
    return fnNode.isAsync();
  }
  return false;
};

const collectImportedFunctionCalls = (
  body: import("ts-morph").Node | undefined,
  imports: ImportInfo[],
  project?: Project
): NestedFunctionCallMeta[] => {
  if (!body) {
    return [];
  }

  const calls: NestedFunctionCallMeta[] = [];
  const seen = new Set<string>();

  body.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.CallExpression)) {
      return;
    }
    const call = node as CallExpression;
    const expression = call.getExpression();
    if (!expression.isKind(SyntaxKind.Identifier)) {
      return;
    }
    const name = expression.getText();
    if (BUILTIN_CALLS.has(name) || seen.has(name)) {
      return;
    }
    const importInfo = findImportForIdentifier(imports, name);
    if (!importInfo?.resolvedPath) {
      return;
    }
    seen.add(name);

    let isAsync = false;
    if (project) {
      const sourceFile =
        project.getSourceFile(importInfo.resolvedPath) ??
        project.addSourceFileAtPathIfExists(importInfo.resolvedPath);
      isAsync = isFunctionAsync(sourceFile, name);
    }

    const awaited =
      call.getParent()?.isKind(SyntaxKind.AwaitExpression) ?? false;

    calls.push({ awaited, functionName: name, isAsync });
  });

  return calls;
};

const mergeUniqueApiCalls = (
  target: ApiCallMeta[],
  incoming: ApiCallMeta[]
): void => {
  for (const call of incoming) {
    const key = `${call.method}:${call.url}:${call.body ?? ""}`;
    if (
      target.some(
        (item) => `${item.method}:${item.url}:${item.body ?? ""}` === key
      )
    ) {
      continue;
    }
    target.push(call);
  }
};

const formatApiCallLabel = (api: ApiCallMeta): string =>
  api.body
    ? `${api.method} ${api.url} · ${api.body}`
    : `${api.method} ${api.url}`;

function analyzeFunctionDeep({
  filePath,
  functionName,
  imports,
  project,
  rootDir,
  tsConfigPath,
  visited,
}: {
  filePath: string;
  functionName: string;
  imports: ImportInfo[];
  project: Project;
  rootDir: string;
  tsConfigPath?: string;
  visited: Set<string>;
}): DataFetchSourceAnalysis | undefined {
  const visitKey = `${filePath}:${functionName}`;
  if (visited.has(visitKey)) {
    return analysisCache.get(visitKey);
  }
  visited.add(visitKey);

  const sourceFile =
    project.getSourceFile(filePath) ??
    project.addSourceFileAtPathIfExists(filePath);
  if (!sourceFile) {
    return undefined;
  }

  const fnNode = findFunctionDeclaration(sourceFile, functionName);
  if (!fnNode) {
    return {
      apiCalls: [],
      executionFlow: [],
      internalCalls: [],
      nestedCallTree: [],
      nestedFunctionCalls: [],
      resolvedFilePath: filePath,
      returnFieldLiterals: {},
    };
  }

  const body = getFunctionBody(fnNode);
  const fileImports = analyzeImportsForFile(
    sourceFile,
    filePath,
    rootDir,
    tsConfigPath
  );

  const analysis: DataFetchSourceAnalysis = {
    apiCalls: collectApiCalls(body, filePath),
    internalCalls: [],
    nestedFunctionCalls: collectImportedFunctionCalls(
      body,
      fileImports,
      project
    ),
    promiseAllLabel: collectPromiseAllLabel(body),
    resolvedFilePath: filePath,
    returnFieldLiterals: {},
  };

  analysis.returnFieldLiterals = collectReturnFieldLiteralsFromBody(
    body,
    filePath
  );

  for (const nested of analysis.nestedFunctionCalls) {
    const nestedImport = findImportForIdentifier(
      fileImports,
      nested.functionName
    );
    if (!nestedImport?.resolvedPath) {
      continue;
    }
    const nestedAnalysis = analyzeFunctionDeep({
      filePath: nestedImport.resolvedPath,
      functionName: nested.functionName,
      imports: fileImports,
      project,
      rootDir,
      tsConfigPath,
      visited,
    });
    if (!nestedAnalysis) {
      continue;
    }
    mergeUniqueApiCalls(analysis.apiCalls, nestedAnalysis.apiCalls);
    analysis.promiseAllLabel ??= nestedAnalysis.promiseAllLabel;
    for (const call of nestedAnalysis.nestedFunctionCalls) {
      if (
        !analysis.nestedFunctionCalls.some(
          (item) => item.functionName === call.functionName
        )
      ) {
        analysis.nestedFunctionCalls.push(call);
      }
    }
    analysis.returnFieldLiterals = {
      ...nestedAnalysis.returnFieldLiterals,
      ...analysis.returnFieldLiterals,
    };
  }

  analysisCache.set(visitKey, analysis);
  return analysis;
}

interface CallTreeBuildContext {
  fileImports: ImportInfo[];
  filePath: string;
  imports: ImportInfo[];
  project: Project;
  rootDir: string;
  tsConfigPath?: string;
  visited: Set<string>;
}

/** Collect imported function calls passed as arguments (must run before the callee). */
const collectCallNodesFromExpression = (
  node: import("ts-morph").Node,
  ctx: CallTreeBuildContext
): DataFetchCallTreeNode[] => {
  if (node.isKind(SyntaxKind.CallExpression)) {
    const built = buildCallExpressionTreeNode({
      awaited: false,
      call: node,
      ...ctx,
    });
    return built ? [built] : [];
  }

  if (node.isKind(SyntaxKind.ArrayLiteralExpression)) {
    const results: DataFetchCallTreeNode[] = [];
    for (const element of node.getElements()) {
      if (element.isKind(SyntaxKind.SpreadElement)) {
        results.push(
          ...collectCallNodesFromExpression(element.getExpression(), ctx)
        );
        continue;
      }
      results.push(...collectCallNodesFromExpression(element, ctx));
    }
    return results;
  }

  if (node.isKind(SyntaxKind.ObjectLiteralExpression)) {
    const results: DataFetchCallTreeNode[] = [];
    for (const property of node.getProperties()) {
      if (property.isKind(SyntaxKind.PropertyAssignment)) {
        const initializer = property.getInitializer();
        if (initializer) {
          results.push(...collectCallNodesFromExpression(initializer, ctx));
        }
        continue;
      }
      if (property.isKind(SyntaxKind.SpreadAssignment)) {
        results.push(
          ...collectCallNodesFromExpression(property.getExpression(), ctx)
        );
      }
    }
    return results;
  }

  if (node.isKind(SyntaxKind.AwaitExpression)) {
    const inner = node.getExpression();
    return inner ? collectCallNodesFromExpression(inner, ctx) : [];
  }

  if (node.isKind(SyntaxKind.ConditionalExpression)) {
    return [
      ...collectCallNodesFromExpression(node.getWhenTrue(), ctx),
      ...collectCallNodesFromExpression(node.getWhenFalse(), ctx),
    ];
  }

  return [];
};

const collectArgumentCallTree = (
  call: CallExpression,
  ctx: CallTreeBuildContext
): DataFetchCallTreeNode[] => {
  const nodes: DataFetchCallTreeNode[] = [];
  for (const arg of call.getArguments()) {
    nodes.push(...collectCallNodesFromExpression(arg, ctx));
  }
  return nodes;
};

export const buildArgumentCallTreeForCall = ({
  call,
  filePath,
  imports,
  project,
  rootDir,
  tsConfigPath,
}: {
  call: CallExpression;
  filePath: string;
  imports: ImportInfo[];
  project?: Project;
  rootDir: string;
  tsConfigPath?: string;
}): DataFetchCallTreeNode[] => {
  if (!project) {
    return [];
  }

  const sourceFile =
    project.getSourceFile(filePath) ??
    project.addSourceFileAtPathIfExists(filePath);
  if (!sourceFile) {
    return [];
  }

  const fileImports = analyzeImportsForFile(
    sourceFile,
    filePath,
    rootDir,
    tsConfigPath
  );

  return collectArgumentCallTree(call, {
    fileImports,
    filePath,
    imports,
    project,
    rootDir,
    tsConfigPath,
    visited: new Set(),
  });
};

function buildCallExpressionTreeNode({
  call,
  awaited,
  fileImports,
  filePath,
  imports,
  project,
  rootDir,
  tsConfigPath,
  visited,
}: {
  call: CallExpression;
  awaited: boolean;
  fileImports: ImportInfo[];
  filePath: string;
  imports: ImportInfo[];
  project: Project;
  rootDir: string;
  tsConfigPath?: string;
  visited: Set<string>;
}): DataFetchCallTreeNode | undefined {
  const callSiteLoc = getSourceLocation(call, filePath);
  const expression = call.getExpression();

  if (
    expression.isKind(SyntaxKind.PropertyAccessExpression) &&
    expression.getName() === "all" &&
    expression.getExpression().getText() === "Promise"
  ) {
    const args = call.getArguments()[0];
    const children: DataFetchCallTreeNode[] = [];
    if (args?.isKind(SyntaxKind.ArrayLiteralExpression)) {
      for (const element of args.getElements()) {
        if (!element.isKind(SyntaxKind.CallExpression)) {
          continue;
        }
        const child = buildCallExpressionTreeNode({
          awaited: false,
          call: element,
          fileImports,
          filePath,
          imports,
          project,
          rootDir,
          tsConfigPath,
          visited,
        });
        if (child) {
          children.push(child);
        }
      }
    }
    return {
      children,
      kind: "promise-all",
      label:
        collectPromiseAllLabel(call.getParent()?.getParent() ?? call) ??
        "Promise.all(...)",
    };
  }

  if (!expression.isKind(SyntaxKind.Identifier)) {
    return undefined;
  }

  const functionName = expression.getText();
  if (BUILTIN_CALLS.has(functionName)) {
    return undefined;
  }

  const importInfo = findImportForIdentifier(fileImports, functionName);
  const sameFileSource =
    project.getSourceFile(filePath) ??
    project.addSourceFileAtPathIfExists(filePath);
  const sameFileDeclaration =
    sameFileSource && findFunctionDeclaration(sameFileSource, functionName);

  const resolvedFilePath =
    importInfo?.resolvedPath ?? (sameFileDeclaration ? filePath : undefined);

  const resolvedFile =
    resolvedFilePath && project
      ? (project.getSourceFile(resolvedFilePath) ??
        project.addSourceFileAtPathIfExists(resolvedFilePath))
      : undefined;

  const treeCtx: CallTreeBuildContext = {
    fileImports,
    filePath,
    imports,
    project,
    rootDir,
    tsConfigPath,
    visited,
  };

  const children: DataFetchCallTreeNode[] = collectArgumentCallTree(
    call,
    treeCtx
  );

  if (resolvedFilePath && project) {
    const nestedAnalysis = analyzeFunctionDeep({
      filePath: resolvedFilePath,
      functionName,
      imports: importInfo ? imports : fileImports,
      project,
      rootDir,
      tsConfigPath,
      visited,
    });
    if (nestedAnalysis) {
      children.push(...nestedAnalysis.nestedCallTree);
      for (const api of nestedAnalysis.apiCalls) {
        children.push({
          callSiteLoc: api.loc,
          children: [],
          kind: "api",
          label: formatApiCallLabel(api),
        });
      }
    }
  }

  const definitionLoc =
    resolvedFilePath && project
      ? resolveFunctionDefinitionLoc({
          functionName,
          imports: fileImports,
          project,
          resolvedFilePath,
          sourceFile: sameFileSource,
        })
      : undefined;

  return {
    awaited,
    callSiteLoc,
    children,
    definitionLoc,
    functionName,
    isAsync: isFunctionAsync(resolvedFile, functionName),
    kind: "function",
    label: `${functionName}()`,
    resolvedFilePath,
    returnType: resolveFunctionReturnType({
      functionName,
      imports: fileImports,
      project,
      resolvedFilePath,
      sourceFile: sameFileSource,
    }),
  };
}

function buildDirectBodyCallTree({
  body,
  fileImports,
  filePath,
  imports,
  project,
  rootDir,
  tsConfigPath,
  visited,
}: {
  body: import("ts-morph").Node | undefined;
  fileImports: ImportInfo[];
  filePath: string;
  imports: ImportInfo[];
  project: Project;
  rootDir: string;
  tsConfigPath?: string;
  visited: Set<string>;
}): DataFetchCallTreeNode[] {
  if (!body?.isKind(SyntaxKind.Block)) {
    return [];
  }

  const nodes: DataFetchCallTreeNode[] = [];

  for (const statement of body.getStatements()) {
    let call: CallExpression | undefined;
    let awaited = false;

    const readCall = (expr: import("ts-morph").Node | undefined) => {
      if (expr?.isKind(SyntaxKind.AwaitExpression)) {
        awaited = true;
        const inner = expr.getExpression();
        if (inner?.isKind(SyntaxKind.CallExpression)) {
          call = inner;
        }
        return;
      }
      if (expr?.isKind(SyntaxKind.CallExpression)) {
        call = expr;
      }
    };

    if (statement.isKind(SyntaxKind.VariableStatement)) {
      for (const declaration of statement.getDeclarations()) {
        readCall(declaration.getInitializer());
      }
    } else if (statement.isKind(SyntaxKind.ReturnStatement)) {
      readCall(statement.getExpression());
    } else if (statement.isKind(SyntaxKind.ExpressionStatement)) {
      readCall(statement.getExpression());
    }

    if (!call) {
      continue;
    }

    const node = buildCallExpressionTreeNode({
      awaited,
      call,
      fileImports,
      imports,
      project,
      rootDir,
      tsConfigPath,
      visited,
    });
    if (node) {
      nodes.push(node);
    }
  }

  return nodes;
}

const analyzeImportsForFile = (
  sourceFile: SourceFile,
  filePath: string,
  rootDir: string,
  tsConfigPath?: string
): ImportInfo[] =>
  analyzeImports({
    filePath,
    rootDir,
    sourceFile,
    tsConfigPath: tsConfigPath ?? "",
  });

export const analyzeDataFetchSource = ({
  filePath,
  functionName,
  importPath,
  imports,
  project,
  rootDir,
  tsConfigPath,
}: {
  filePath: string;
  functionName: string;
  importPath?: string;
  imports?: ImportInfo[];
  project?: Project;
  rootDir: string;
  tsConfigPath?: string;
}): DataFetchSourceAnalysis | undefined => {
  if (!importPath || !project) {
    return undefined;
  }

  const { resolvedPath } = resolveImport({
    currentFile: filePath,
    moduleSpecifier: importPath,
    rootDir,
    tsConfigPath,
  });

  if (!resolvedPath) {
    return undefined;
  }

  analysisCache.clear();

  const rootImports =
    imports ??
    analyzeImportsForFile(
      project.getSourceFile(filePath) ??
        project.addSourceFileAtPathIfExists(filePath)!,
      filePath,
      rootDir,
      tsConfigPath
    );

  return analyzeFunctionDeep({
    filePath: resolvedPath,
    functionName,
    imports: rootImports,
    project,
    rootDir,
    tsConfigPath,
    visited: new Set(),
  });
};

export const mergeDataFetchSourceAnalysis = (
  meta: DataFetchMeta,
  analysis: DataFetchSourceAnalysis | undefined
): DataFetchMeta => {
  if (!analysis) {
    return meta;
  }
  return {
    ...meta,
    apiCalls: analysis.apiCalls,
    definitionLoc: analysis.definitionLoc,
    executionFlow: analysis.executionFlow,
    internalCalls: analysis.internalCalls,
    nestedCallTree: analysis.nestedCallTree,
    nestedFunctionCallMeta: analysis.nestedFunctionCalls,
    nestedFunctionCalls: analysis.nestedFunctionCalls.map(
      (call) => call.functionName
    ),
    promiseAllLabel: analysis.promiseAllLabel,
    resolvedFilePath: analysis.resolvedFilePath,
    returnFieldLiterals: analysis.returnFieldLiterals,
    returnType: analysis.returnType,
  };
};
