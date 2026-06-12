import type { CallExpression, Node, Project } from "ts-morph";
import { SyntaxKind } from "ts-morph";

import type { mergeAnalyzerConfig } from "../config";
import { createNodeId } from "../graph/createGraph";
import type { GraphBuilder } from "../graph/createGraph";
import type { ImportInfo, LogicGraphNode } from "../types";
import {
  collectAwaitCalls,
  getNodeText,
  getSourceLocation,
  resolveAssignmentStatementLoc,
} from "../utils/ast";
import {
  analyzeDataFetchSource,
  mergeDataFetchSourceAnalysis,
} from "./analyzeDataFetchSource";
import { analyzeHookCallsInBody } from "./analyzeHooks";
import { findImportForIdentifier } from "./analyzeImports";
import { analyzeFunctionLocals } from "./analyzeLocals";
import { analyzeReturnPaths } from "./analyzeReturnPaths";

export interface AnalyzeFunctionBodyContext {
  filePath: string;
  imports: ImportInfo[];
  graph: GraphBuilder;
  parentNode: LogicGraphNode;
  config: ReturnType<typeof mergeAnalyzerConfig>;
  rootDir?: string;
  project?: Project;
  tsConfigPath?: string;
}

const findAwaitAssignmentNames = (awaitNode: Node): string[] => {
  let current: Node | undefined = awaitNode;
  while (current) {
    const parent = current.getParent();
    if (!parent) {
      break;
    }
    if (parent.isKind(SyntaxKind.VariableDeclaration)) {
      const nameNode = parent.getNameNode();
      if (nameNode.isKind(SyntaxKind.Identifier)) {
        return [nameNode.getText()];
      }
      if (nameNode.isKind(SyntaxKind.ObjectBindingPattern)) {
        return nameNode.getElements().map((element) => element.getName());
      }
    }
    if (parent.isKind(SyntaxKind.Block)) {
      break;
    }
    current = parent;
  }
  return [];
};

const extractCallName = (node: Node): string | undefined => {
  if (!node.isKind(SyntaxKind.CallExpression)) {
    return undefined;
  }

  const call = node as CallExpression;
  const expression = call.getExpression();

  if (expression.isKind(SyntaxKind.Identifier)) {
    return expression.getText();
  }

  if (expression.isKind(SyntaxKind.PropertyAccessExpression)) {
    return getNodeText(expression);
  }

  return getNodeText(expression);
};

export const analyzeFunctionBody = ({
  body,
  ctx,
  propNames = [],
}: {
  body: Node | undefined;
  ctx: AnalyzeFunctionBodyContext;
  propNames?: string[];
}): void => {
  if (!body) {
    ctx.graph.addWarning({
      code: "NO_RETURN_JSX_FOUND",
      filePath: ctx.filePath,
      message: "No function body found for page component",
    });
    return;
  }

  const awaitCalls = collectAwaitCalls(body);
  for (const awaitNode of awaitCalls) {
    const innerExpr = awaitNode.isKind(SyntaxKind.AwaitExpression)
      ? awaitNode.getExpression()
      : awaitNode;
    const functionName = extractCallName(innerExpr) ?? "unknown";
    const callExpression = getNodeText(innerExpr);
    const importInfo = findImportForIdentifier(ctx.imports, functionName);

    const outputNames = findAwaitAssignmentNames(awaitNode);

    const callTarget = innerExpr?.isKind(SyntaxKind.CallExpression)
      ? innerExpr
      : awaitNode;

    const baseFetch: LogicGraphNode["dataFetch"] = {
      assignmentLoc: resolveAssignmentStatementLoc(awaitNode, ctx.filePath),
      awaited: true,
      callExpression,
      callSiteLoc: getSourceLocation(callTarget, ctx.filePath),
      functionName,
      importPath: importInfo?.moduleSpecifier,
      outputNames: outputNames.length > 0 ? outputNames : undefined,
      sourceKind: "api",
    };

    const sourceAnalysis =
      ctx.rootDir && ctx.project
        ? analyzeDataFetchSource({
            filePath: ctx.filePath,
            functionName,
            importPath: importInfo?.moduleSpecifier,
            imports: ctx.imports,
            project: ctx.project,
            rootDir: ctx.rootDir,
            tsConfigPath: ctx.tsConfigPath,
          })
        : undefined;

    const dataNode: LogicGraphNode = {
      dataFetch: mergeDataFetchSourceAnalysis(baseFetch, sourceAnalysis),
      id: createNodeId({
        filePath: ctx.filePath,
        name: functionName,
        type: "data-fetch",
      }),
      label: `await ${callExpression}`,
      loc: baseFetch.assignmentLoc,
      metadata: { category: "data" },
      type: "data-fetch",
    };

    ctx.graph.addNode(dataNode);
    ctx.graph.addEdge(ctx.parentNode.id, dataNode.id, "calls");
  }

  analyzeHookCallsInBody({ body, ctx });

  if (body.isKind(SyntaxKind.Block)) {
    for (const statement of body.getStatements()) {
      if (statement.isKind(SyntaxKind.ReturnStatement)) {
        break;
      }
      if (!statement.isKind(SyntaxKind.VariableStatement)) {
        continue;
      }
      for (const declaration of statement.getDeclarations()) {
        const initializer = declaration.getInitializer();
        if (!initializer?.isKind(SyntaxKind.CallExpression)) {
          continue;
        }
        if (
          initializer
            .getAncestors()
            .some((ancestor) => ancestor.isKind(SyntaxKind.AwaitExpression))
        ) {
          continue;
        }
        const functionName = extractCallName(initializer) ?? "unknown";
        const callExpression = getNodeText(initializer);
        const importInfo = findImportForIdentifier(ctx.imports, functionName);
        const nameNode = declaration.getNameNode();
        let outputNames: string[] = [];
        if (nameNode.isKind(SyntaxKind.Identifier)) {
          outputNames = [nameNode.getText()];
        } else if (nameNode.isKind(SyntaxKind.ObjectBindingPattern)) {
          outputNames = nameNode
            .getElements()
            .map((element) => element.getName());
        }

        const baseFetch: LogicGraphNode["dataFetch"] = {
          assignmentLoc: getSourceLocation(statement, ctx.filePath),
          awaited: false,
          callExpression,
          callSiteLoc: getSourceLocation(initializer, ctx.filePath),
          functionName,
          importPath: importInfo?.moduleSpecifier,
          outputNames: outputNames.length > 0 ? outputNames : undefined,
          sourceKind: "function",
        };

        const sourceAnalysis =
          ctx.rootDir && ctx.project
            ? analyzeDataFetchSource({
                filePath: ctx.filePath,
                functionName,
                importPath: importInfo?.moduleSpecifier,
                imports: ctx.imports,
                project: ctx.project,
                rootDir: ctx.rootDir,
                tsConfigPath: ctx.tsConfigPath,
              })
            : undefined;

        const dataNode: LogicGraphNode = {
          dataFetch: mergeDataFetchSourceAnalysis(baseFetch, sourceAnalysis),
          id: createNodeId({
            filePath: ctx.filePath,
            name: `fn:${functionName}`,
            type: "data-fetch",
          }),
          label: callExpression,
          loc: baseFetch.assignmentLoc,
          metadata: { category: "data", dataSourceKind: "function" },
          type: "data-fetch",
        };

        ctx.graph.addNode(dataNode);
        ctx.graph.addEdge(ctx.parentNode.id, dataNode.id, "calls");
      }
    }
  }

  ctx.parentNode.locals = analyzeFunctionLocals({ body, ctx, propNames });

  const hasReturnPaths = analyzeReturnPaths(body, ctx);
  if (!hasReturnPaths) {
    ctx.graph.addWarning({
      code: "NO_RETURN_JSX_FOUND",
      filePath: ctx.filePath,
      message: "No return JSX found in page component",
    });
  }
};
