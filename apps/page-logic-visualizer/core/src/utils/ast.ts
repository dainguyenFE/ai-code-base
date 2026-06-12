import type {
  Node,
  SourceFile,
  JsxAttribute,
  JsxElement,
  JsxExpression,
  JsxFragment,
  JsxSelfClosingElement,
} from "ts-morph";
import { SyntaxKind } from "ts-morph";

import type { SourceLocation } from "../types";
import { normalizePath } from "./path";

export const getNodeText = (node: Node): string => node.getText().trim();

export const getSourceLocation = (
  node: Node,
  filePath: string
): SourceLocation => {
  const start = node.getStartLineNumber();
  const end = node.getEndLineNumber();
  const sourceFile = node.getSourceFile();
  const startPos = node.getStart();
  const endPos = node.getEnd();

  return {
    endColumn: sourceFile.getLineAndColumnAtPos(endPos).column,
    endLine: end,
    filePath: normalizePath(filePath),
    startColumn: sourceFile.getLineAndColumnAtPos(startPos).column,
    startLine: start,
  };
};

/** Full `const x = …` statement containing an expression (await call, initializer, etc.). */
export const resolveAssignmentStatementLoc = (
  expressionNode: Node,
  filePath: string
): SourceLocation => {
  let current: Node | undefined = expressionNode;

  while (current) {
    const parent = current.getParent();
    if (!parent) {
      break;
    }
    if (parent.isKind(SyntaxKind.VariableStatement)) {
      return getSourceLocation(parent, filePath);
    }
    if (parent.isKind(SyntaxKind.Block)) {
      break;
    }
    current = parent;
  }

  return getSourceLocation(expressionNode, filePath);
};

export const getJsxTagName = (
  node: JsxElement | JsxSelfClosingElement
): string => {
  const opening = node.isKind(SyntaxKind.JsxElement)
    ? node.getOpeningElement()
    : node;

  const tagNameNode = opening.getTagNameNode();
  return getNodeText(tagNameNode);
};

export const getJsxChildren = (node: JsxElement | JsxFragment): Node[] =>
  node
    .getJsxChildren()
    .filter(
      (
        child
      ): child is
        | JsxElement
        | JsxSelfClosingElement
        | JsxExpression
        | JsxFragment =>
        child.isKind(SyntaxKind.JsxElement) ||
        child.isKind(SyntaxKind.JsxSelfClosingElement) ||
        child.isKind(SyntaxKind.JsxExpression) ||
        child.isKind(SyntaxKind.JsxFragment)
    );

export const findReturnJsx = (body: Node | undefined): Node | undefined => {
  if (!body) {
    return undefined;
  }

  if (
    body.isKind(SyntaxKind.JsxElement) ||
    body.isKind(SyntaxKind.JsxFragment) ||
    body.isKind(SyntaxKind.JsxSelfClosingElement)
  ) {
    return body;
  }

  if (body.isKind(SyntaxKind.Block)) {
    for (const statement of body.getStatements()) {
      if (statement.isKind(SyntaxKind.ReturnStatement)) {
        const expr = statement.getExpression();
        if (expr) {
          return unwrapExpression(expr);
        }
      }
    }
  }

  if (body.isKind(SyntaxKind.ParenthesizedExpression)) {
    return findReturnJsx(body.getExpression());
  }

  return undefined;
};

export const unwrapExpression = (node: Node): Node => {
  if (node.isKind(SyntaxKind.ParenthesizedExpression)) {
    return unwrapExpression(node.getExpression());
  }
  return node;
};

export const collectAwaitCalls = (body: Node | undefined): Node[] => {
  if (!body) {
    return [];
  }

  const results: Node[] = [];

  body.forEachDescendant((node) => {
    if (node.getKind() === SyntaxKind.AwaitExpression) {
      results.push(node);
    }
  });

  return results;
};

export const getJsxAttributes = (
  node: JsxElement | JsxSelfClosingElement
): JsxAttribute[] => {
  const opening = node.isKind(SyntaxKind.JsxElement)
    ? node.getOpeningElement()
    : node;

  return opening
    .getAttributes()
    .filter((attr) => attr.isKind(SyntaxKind.JsxAttribute));
};

export const unwrapJsxExpression = (node: Node): Node | undefined => {
  if (node.isKind(SyntaxKind.JsxExpression)) {
    const expr = (node as JsxExpression).getExpression();
    return expr ?? undefined;
  }
  return node;
};

export const extractExpressionInputs = (expression: string): string[] => {
  const matches =
    expression.match(/[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*/g) ?? [];
  const keywords = new Set(["true", "false", "null", "undefined", "length"]);
  return [...new Set(matches.filter((token) => !keywords.has(token)))];
};

export const getBranchLabel = (node: Node): string => {
  if (node.isKind(SyntaxKind.ParenthesizedExpression)) {
    return getBranchLabel(node.getExpression());
  }
  if (
    node.isKind(SyntaxKind.JsxElement) ||
    node.isKind(SyntaxKind.JsxSelfClosingElement)
  ) {
    return getJsxTagName(node as JsxElement | JsxSelfClosingElement);
  }
  if (node.isKind(SyntaxKind.JsxFragment)) {
    return "Fragment";
  }
  if (node.isKind(SyntaxKind.NullKeyword)) {
    return "null (render nothing)";
  }
  if (node.isKind(SyntaxKind.Identifier)) {
    return node.getText();
  }
  const text = getNodeText(node);
  return text.length > 48 ? `${text.slice(0, 45)}...` : text;
};

export const isJsxStructure = (node: Node): boolean =>
  node.isKind(SyntaxKind.JsxElement) ||
  node.isKind(SyntaxKind.JsxSelfClosingElement) ||
  node.isKind(SyntaxKind.JsxFragment) ||
  node.isKind(SyntaxKind.JsxExpression);

export const getDefaultExportName = (
  sourceFile: SourceFile
): string | undefined => {
  const defaultExport = sourceFile.getDefaultExportSymbol();
  if (!defaultExport) {
    return undefined;
  }
  return defaultExport.getName();
};
