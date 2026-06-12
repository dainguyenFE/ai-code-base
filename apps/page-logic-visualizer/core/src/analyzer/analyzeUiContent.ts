import type { JsxElement, JsxExpression, JsxText, Node } from "ts-morph";
import { SyntaxKind } from "ts-morph";

import type { mergeAnalyzerConfig } from "../config";
import { createNodeId } from "../graph/createGraph";
import type { GraphBuilder } from "../graph/createGraph";
import type { DataValueKind, LogicGraphNode } from "../types";
import { getNodeText, getSourceLocation } from "../utils/ast";

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
  if (expression.includes(".map(")) {
    return "list";
  }
  if (
    expression.includes("features") ||
    expression.includes("faqs") ||
    expression.includes("plans")
  ) {
    return "list";
  }
  return "unknown";
};

const truncate = (value: string, max = 56): string =>
  value.length > max ? `${value.slice(0, max - 3)}...` : value;

export const analyzeUiContentChild = (
  child: Node,
  parentNode: LogicGraphNode,
  ctx: {
    filePath: string;
    graph: GraphBuilder;
    config: ReturnType<typeof mergeAnalyzerConfig>;
  }
): void => {
  if (child.isKind(SyntaxKind.JsxText)) {
    const text = (child as JsxText).getText().replaceAll(/\s+/g, " ").trim();
    if (!text) {
      return;
    }
    const uiNode: LogicGraphNode = {
      id: createNodeId({
        column: getSourceLocation(child, ctx.filePath).startColumn,
        filePath: ctx.filePath,
        line: getSourceLocation(child, ctx.filePath).startLine,
        name: truncate(text),
        type: "ui-content",
      }),
      label: truncate(text),
      loc: getSourceLocation(child, ctx.filePath),
      metadata: { category: "ui" },
      type: "ui-content",
      uiContent: {
        contentKind: "string",
        preview: truncate(text),
      },
    };
    ctx.graph.addNode(uiNode);
    ctx.graph.addEdge(parentNode.id, uiNode.id, "displays", "text");
    return;
  }

  if (child.isKind(SyntaxKind.JsxExpression)) {
    const expr = (child as JsxExpression).getExpression();
    if (!expr) {
      return;
    }
    const expression = getNodeText(expr);
    const uiNode: LogicGraphNode = {
      id: createNodeId({
        column: getSourceLocation(child, ctx.filePath).startColumn,
        filePath: ctx.filePath,
        line: getSourceLocation(child, ctx.filePath).startLine,
        name: expression,
        type: "ui-content",
      }),
      label: `{${truncate(expression)}}`,
      loc: getSourceLocation(child, ctx.filePath),
      metadata: { category: "ui" },
      type: "ui-content",
      uiContent: {
        bindsTo: expression,
        contentKind: inferDataKind(expression),
        preview: `{${truncate(expression)}}`,
      },
    };
    ctx.graph.addNode(uiNode);
    ctx.graph.addEdge(parentNode.id, uiNode.id, "displays", "binding");
  }
};

export const analyzeUiContentInElement = (
  element: JsxElement,
  parentNode: LogicGraphNode,
  ctx: {
    filePath: string;
    graph: GraphBuilder;
    config: ReturnType<typeof mergeAnalyzerConfig>;
  }
): void => {
  for (const child of element.getJsxChildren()) {
    if (
      child.isKind(SyntaxKind.JsxText) ||
      child.isKind(SyntaxKind.JsxExpression)
    ) {
      analyzeUiContentChild(child, parentNode, ctx);
    }
  }
};
