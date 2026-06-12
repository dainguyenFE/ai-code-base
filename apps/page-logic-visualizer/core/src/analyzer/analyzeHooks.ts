import type {
  Block,
  CallExpression,
  Node,
  ObjectLiteralExpression,
  SourceFile,
  VariableDeclaration,
} from "ts-morph";
import { SyntaxKind } from "ts-morph";

import type { mergeAnalyzerConfig } from "../config";
import { createNodeId } from "../graph/createGraph";
import type { GraphBuilder } from "../graph/createGraph";
import type {
  DataValueKind,
  HookIOField,
  ImportInfo,
  LogicGraphNode,
} from "../types";
import { getNodeText, getSourceLocation } from "../utils/ast";
import {
  extractContextName,
  extractStoreName,
  isContextHook,
  isStoreHook,
  resolveStoreLibrary,
} from "./analyzeDataSources";
import type { AnalyzeFunctionBodyContext } from "./analyzeFunctionBody";
import { analyzeImports, findImportForIdentifier } from "./analyzeImports";
import { analyzeModuleBindings } from "./analyzeModuleBindings";

interface HookCallSite {
  hookName: string;
  callExpression: string;
  callNode: CallExpression;
  outputNames: string[];
  argumentExpressions: string[];
}

const isHookName = (name: string): boolean => /^use[A-Z]/.test(name);

const inferDataKind = (expression: string): DataValueKind => {
  if (
    expression.startsWith('"') ||
    expression.startsWith("'") ||
    expression.startsWith("`")
  ) {
    return "string";
  }
  if (/^-?\d+(\.\d+)?$/.test(expression)) {
    return "number";
  }
  if (expression === "true" || expression === "false") {
    return "boolean";
  }
  if (expression.endsWith(".map(") || expression.includes(".map(")) {
    return "list";
  }
  if (
    expression.includes(".length") ||
    expression.includes("faqs") ||
    expression.includes("plans") ||
    expression.includes("items") ||
    expression.includes("features")
  ) {
    return "list";
  }
  if (expression.startsWith("{") || expression.includes(": ")) {
    return "object";
  }
  if (
    expression.includes("=>") ||
    expression.startsWith("function") ||
    /\bfunction\s*\(/.test(expression)
  ) {
    return "function";
  }
  return "unknown";
};

const extractDestructuredNames = (
  declaration: VariableDeclaration
): string[] => {
  const nameNode = declaration.getNameNode();
  if (nameNode.isKind(SyntaxKind.Identifier)) {
    return [nameNode.getText()];
  }
  if (nameNode.isKind(SyntaxKind.ObjectBindingPattern)) {
    return nameNode
      .getElements()
      .map((element) => element.getName())
      .filter(Boolean);
  }
  return [];
};

const collectHookCallsFromBlock = (block: Block): HookCallSite[] => {
  const results: HookCallSite[] = [];

  for (const statement of block.getStatements()) {
    if (statement.isKind(SyntaxKind.ReturnStatement)) {
      break;
    }

    if (statement.isKind(SyntaxKind.VariableStatement)) {
      for (const declaration of statement.getDeclarations()) {
        const initializer = declaration.getInitializer();
        if (!initializer?.isKind(SyntaxKind.CallExpression)) {
          continue;
        }
        const call = initializer as CallExpression;
        const hookName = getHookNameFromCall(call);
        if (!hookName) {
          continue;
        }
        results.push({
          argumentExpressions: call
            .getArguments()
            .map((arg) => getNodeText(arg)),
          callExpression: getNodeText(call),
          callNode: call,
          hookName,
          outputNames: extractDestructuredNames(declaration),
        });
      }
    }
  }

  return results;
};

const getHookNameFromCall = (call: CallExpression): string | undefined => {
  const expression = call.getExpression();
  if (expression.isKind(SyntaxKind.Identifier)) {
    const name = expression.getText();
    return isHookName(name) ? name : undefined;
  }
  return undefined;
};

const findUsagesInBody = (
  body: Node | undefined,
  names: string[]
): Map<string, string[]> => {
  const usage = new Map<string, string[]>();
  for (const name of names) {
    usage.set(name, []);
  }
  if (!body || names.length === 0) {
    return usage;
  }

  const bodyText = getNodeText(body);
  for (const name of names) {
    const contexts: string[] = [];
    if (bodyText.includes(`{${name}`) || bodyText.includes(`${name}.`)) {
      contexts.push("JSX expression");
    }
    if (bodyText.includes(`${name}?`) || bodyText.includes(`&& ${name}`)) {
      contexts.push("condition");
    }
    if (bodyText.includes(`${name}=`) || bodyText.includes(`${name}:`)) {
      contexts.push("props");
    }
    if (contexts.length > 0) {
      usage.set(name, contexts);
    }
  }
  return usage;
};

const buildHookInputs = (argumentExpressions: string[]): HookIOField[] => {
  if (argumentExpressions.length === 0) {
    return [];
  }

  const single = argumentExpressions[0];
  if (!single) {
    return [];
  }

  if (single.startsWith("{") && single.endsWith("}")) {
    return single
      .slice(1, -1)
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, value] = part.split(":").map((item) => item.trim());
        const name = key ?? part;
        const source = value ?? part;
        return {
          kind: inferDataKind(source),
          name,
          source,
        };
      });
  }

  return argumentExpressions.map((expression, index) => ({
    kind: inferDataKind(expression),
    name: `arg${index}`,
    source: expression,
  }));
};

const parseHookReturnOutputs = (
  sourceFile: SourceFile,
  hookName: string
): HookIOField[] => {
  for (const fn of sourceFile.getFunctions()) {
    if (fn.getName() !== hookName) {
      continue;
    }
    const body = fn.getBody();
    if (!body?.isKind(SyntaxKind.Block)) {
      continue;
    }
    for (const statement of body.getStatements()) {
      if (!statement.isKind(SyntaxKind.ReturnStatement)) {
        continue;
      }
      const expr = statement.getExpression();
      if (expr?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        const fields: HookIOField[] = [];
        for (const property of (
          expr as ObjectLiteralExpression
        ).getProperties()) {
          if (!property.isKind(SyntaxKind.PropertyAssignment)) {
            continue;
          }
          const name = property.getName();
          const init = property.getInitializer();
          const source = init ? getNodeText(init) : undefined;
          fields.push({
            kind: inferDataKind(source ?? name),
            name,
            source,
          });
        }
        return fields;
      }
    }
  }
  return [];
};

const collectNestedHooksInFile = (
  sourceFile: SourceFile,
  hookName: string
): string[] => {
  for (const fn of sourceFile.getFunctions()) {
    if (fn.getName() !== hookName) {
      continue;
    }
    const body = fn.getBody();
    if (!body) {
      return [];
    }
    const nested: string[] = [];
    body.forEachDescendant((node) => {
      if (!node.isKind(SyntaxKind.CallExpression)) {
        return;
      }
      const name = getHookNameFromCall(node as CallExpression);
      if (name && name !== hookName) {
        nested.push(name);
      }
    });
    return [...new Set(nested)];
  }
  return [];
};

const addNestedHookNodes = ({
  ctx,
  parentHookNodeId,
  parentHookName,
  nestedName,
  hookImports,
  visited,
}: {
  ctx: AnalyzeFunctionBodyContext;
  parentHookNodeId: string;
  parentHookName: string;
  nestedName: string;
  hookImports: ImportInfo[];
  visited: Set<string>;
}): void => {
  const visitKey = `${parentHookName}->${nestedName}`;
  if (visited.has(visitKey)) {
    return;
  }
  visited.add(visitKey);

  const nestedImport = findImportForIdentifier(hookImports, nestedName);
  let nestedSourceFile: SourceFile | undefined;
  let nestedFileImports = hookImports;
  if (nestedImport?.resolvedPath && ctx.project) {
    nestedSourceFile =
      ctx.project.getSourceFile(nestedImport.resolvedPath) ??
      ctx.project.addSourceFileAtPath(nestedImport.resolvedPath);
    nestedFileImports = analyzeImports({
      filePath: nestedImport.resolvedPath,
      rootDir: ctx.rootDir ?? process.cwd(),
      sourceFile: nestedSourceFile,
      tsConfigPath: ctx.tsConfigPath ?? "",
    });
  }

  const deeperNested = nestedSourceFile
    ? collectNestedHooksInFile(nestedSourceFile, nestedName)
    : [];

  const nestedNode: LogicGraphNode = {
    filePath: nestedImport?.resolvedPath,
    hook: {
      callExpression: `${nestedName}()`,
      hookName: nestedName,
      importPath: nestedImport?.moduleSpecifier,
      inputs: [],
      nestedHooks: deeperNested,
      outputs: [],
    },
    id: createNodeId({
      filePath: nestedImport?.resolvedPath ?? ctx.filePath,
      name: `${parentHookName}->${nestedName}`,
      type: "hook",
    }),
    importPath: nestedImport?.moduleSpecifier,
    label: nestedName,
    metadata: { category: "logic", nestedIn: parentHookName },
    type: "hook",
  };

  ctx.graph.addNode(nestedNode);
  ctx.graph.addEdge(parentHookNodeId, nestedNode.id, "uses-hook", "nested");

  for (const deeperName of deeperNested) {
    addNestedHookNodes({
      ctx,
      hookImports: nestedFileImports,
      nestedName: deeperName,
      parentHookName: nestedName,
      parentHookNodeId: nestedNode.id,
      visited,
    });
  }
};

const enrichOutputsFromDefinition = (
  outputs: HookIOField[],
  sourceFile: SourceFile | undefined,
  hookName: string
): HookIOField[] => {
  if (!sourceFile) {
    return outputs;
  }
  const defined = parseHookReturnOutputs(sourceFile, hookName);
  if (defined.length === 0) {
    return outputs;
  }
  const byName = new Map(defined.map((field) => [field.name, field]));
  return outputs.map((output) => {
    const definition = byName.get(output.name);
    return definition ? { ...definition, usedIn: output.usedIn } : output;
  });
};

export const analyzeHookCallsInBody = ({
  body,
  ctx,
}: {
  body: Node | undefined;
  ctx: AnalyzeFunctionBodyContext;
}): void => {
  if (!body?.isKind(SyntaxKind.Block)) {
    return;
  }

  const hookCalls = collectHookCallsFromBlock(body);
  if (hookCalls.length === 0) {
    return;
  }

  const usageMap = findUsagesInBody(
    body,
    hookCalls.flatMap((call) => call.outputNames)
  );

  for (const callSite of hookCalls) {
    const importInfo = findImportForIdentifier(ctx.imports, callSite.hookName);
    const hookFile = importInfo?.resolvedPath;
    let sourceFile: SourceFile | undefined;
    let hookImports = ctx.imports;
    if (hookFile && ctx.project) {
      sourceFile =
        ctx.project.getSourceFile(hookFile) ??
        ctx.project.addSourceFileAtPath(hookFile);
      hookImports = analyzeImports({
        filePath: hookFile,
        rootDir: ctx.rootDir ?? process.cwd(),
        sourceFile,
        tsConfigPath: ctx.tsConfigPath ?? "",
      });
    }

    if (isContextHook(callSite.hookName)) {
      const contextNode: LogicGraphNode = {
        context: {
          callExpression: callSite.callExpression,
          contextName: extractContextName(callSite.argumentExpressions),
          importPath: importInfo?.moduleSpecifier,
          outputNames:
            callSite.outputNames.length > 0 ? callSite.outputNames : undefined,
        },
        filePath: hookFile ?? ctx.filePath,
        id: createNodeId({
          column: getSourceLocation(callSite.callNode, ctx.filePath)
            .startColumn,
          filePath: ctx.filePath,
          line: getSourceLocation(callSite.callNode, ctx.filePath).startLine,
          name: extractContextName(callSite.argumentExpressions),
          type: "context",
        }),
        importPath: importInfo?.moduleSpecifier,
        label: extractContextName(callSite.argumentExpressions),
        loc: getSourceLocation(callSite.callNode, ctx.filePath),
        metadata: { category: "data", dataSourceKind: "context" },
        type: "context",
      };

      ctx.graph.addNode(contextNode);
      ctx.graph.addEdge(
        ctx.parentNode.id,
        contextNode.id,
        "uses-hook",
        "context"
      );
      continue;
    }

    if (isStoreHook(callSite.hookName, importInfo)) {
      const library = resolveStoreLibrary(callSite.hookName, importInfo);
      const storeNode: LogicGraphNode = {
        filePath: hookFile ?? ctx.filePath,
        id: createNodeId({
          column: getSourceLocation(callSite.callNode, ctx.filePath)
            .startColumn,
          filePath: ctx.filePath,
          line: getSourceLocation(callSite.callNode, ctx.filePath).startLine,
          name: callSite.hookName,
          type: "store",
        }),
        importPath: importInfo?.moduleSpecifier,
        label: `${library}: ${callSite.hookName}`,
        loc: getSourceLocation(callSite.callNode, ctx.filePath),
        metadata: {
          category: "data",
          dataSourceKind: "store",
          storeLibrary: library,
        },
        store: {
          callExpression: callSite.callExpression,
          importPath: importInfo?.moduleSpecifier,
          library,
          outputNames:
            callSite.outputNames.length > 0 ? callSite.outputNames : undefined,
          selector: callSite.argumentExpressions[0],
          storeName: extractStoreName(
            callSite.hookName,
            callSite.argumentExpressions,
            importInfo
          ),
        },
        type: "store",
      };

      ctx.graph.addNode(storeNode);
      ctx.graph.addEdge(ctx.parentNode.id, storeNode.id, "uses-hook", "store");
      continue;
    }

    const nestedHooks = sourceFile
      ? collectNestedHooksInFile(sourceFile, callSite.hookName)
      : [];

    const outputs: HookIOField[] = callSite.outputNames.map((name) => ({
      kind: "unknown",
      name,
      usedIn: usageMap.get(name),
    }));

    const hookNode: LogicGraphNode = {
      filePath: hookFile ?? ctx.filePath,
      hook: {
        callExpression: callSite.callExpression,
        hookName: callSite.hookName,
        importPath: importInfo?.moduleSpecifier,
        inputs: buildHookInputs(callSite.argumentExpressions),
        nestedHooks,
        outputs: enrichOutputsFromDefinition(
          outputs,
          sourceFile,
          callSite.hookName
        ),
      },
      id: createNodeId({
        column: getSourceLocation(callSite.callNode, ctx.filePath).startColumn,
        filePath: ctx.filePath,
        line: getSourceLocation(callSite.callNode, ctx.filePath).startLine,
        name: callSite.hookName,
        type: "hook",
      }),
      importPath: importInfo?.moduleSpecifier,
      label: callSite.hookName,
      loc: getSourceLocation(callSite.callNode, ctx.filePath),
      metadata: {
        category: "logic",
        expandable: Boolean(hookFile),
        moduleBindings:
          sourceFile && hookFile
            ? analyzeModuleBindings({
                filePath: hookFile,
                imports: hookImports,
                project: ctx.project,
                rootDir: ctx.rootDir ?? process.cwd(),
                sourceFile,
                tsConfigPath: ctx.tsConfigPath ?? "",
              })
            : undefined,
      },
      type: "hook",
    };

    ctx.graph.addNode(hookNode);
    ctx.graph.addEdge(ctx.parentNode.id, hookNode.id, "uses-hook");

    for (const input of hookNode.hook?.inputs ?? []) {
      ctx.graph.addEdge(
        hookNode.id,
        ctx.parentNode.id,
        "hook-input",
        input.name
      );
    }

    for (const output of hookNode.hook?.outputs ?? []) {
      ctx.graph.addEdge(
        hookNode.id,
        ctx.parentNode.id,
        "hook-output",
        output.name
      );
    }

    for (const nestedName of nestedHooks) {
      addNestedHookNodes({
        ctx,
        hookImports,
        nestedName,
        parentHookName: callSite.hookName,
        parentHookNodeId: hookNode.id,
        visited: new Set(),
      });
    }
  }
};
