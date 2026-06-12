import type {
  Node,
  BinaryExpression,
  CallExpression,
  ConditionalExpression,
  JsxElement,
  JsxFragment,
  JsxSelfClosingElement,
  SourceFile,
} from "ts-morph";
import { SyntaxKind } from "ts-morph";

import type { mergeAnalyzerConfig } from "../config";
import { createNodeId } from "../graph/createGraph";
import type { GraphBuilder } from "../graph/createGraph";
import type {
  ImportInfo,
  LogicGraphEdgeType,
  LogicGraphNode,
  PropKind,
  PropUsage,
} from "../types";
import {
  extractExpressionInputs,
  getBranchLabel,
  getJsxAttributes,
  getJsxChildren,
  getJsxTagName,
  getNodeText,
  getSourceLocation,
  isJsxStructure,
} from "../utils/ast";
import { isHtmlElement, isReactComponentTag } from "../utils/path";
import {
  isHtmlLayoutWrapperTag,
  isSemanticHtmlTag,
  semanticTierForTag,
} from "../utils/semanticHtml";
import { findComponentByName } from "./analyzeComponent";
import type { AnalyzeFunctionBodyContext } from "./analyzeFunctionBody";
import { findImportForIdentifier } from "./analyzeImports";
import { analyzeFunctionLocals } from "./analyzeLocals";
import { analyzeUiContentInElement } from "./analyzeUiContent";

export interface AnalyzeJsxContext {
  filePath: string;
  imports: ImportInfo[];
  graph: GraphBuilder;
  config: ReturnType<typeof mergeAnalyzerConfig>;
  depth: number;
  edgeType?: LogicGraphEdgeType;
  edgeLabel?: string;
  sourceFile?: SourceFile;
  runShallowPreview?: (node: LogicGraphNode, tagName: string) => void;
}

const shouldIncludeHtmlTag = (
  tagName: string,
  config: ReturnType<typeof mergeAnalyzerConfig>
): boolean =>
  config.includeHtmlElements ||
  config.includeHtmlTags.includes(tagName.toLowerCase());

/** Direct text / expression children for leaf HTML display (not nested elements). */
const extractHtmlTextPreview = (element: JsxElement): string | undefined => {
  const parts: string[] = [];

  // Use raw getJsxChildren — utils getJsxChildren filters out JsxText.
  for (const child of element.getJsxChildren()) {
    if (child.isKind(SyntaxKind.JsxText)) {
      const text = child.getText().replaceAll(/\s+/g, " ").trim();
      if (text) {
        parts.push(text);
      }
      continue;
    }
    if (child.isKind(SyntaxKind.JsxExpression)) {
      const expr = child.getExpression();
      if (expr) {
        parts.push(`{${getNodeText(expr)}}`);
      }
    }
  }

  if (parts.length === 0) {
    return undefined;
  }

  const preview = parts.join(" ");
  return preview.length > 120 ? `${preview.slice(0, 117)}...` : preview;
};

const htmlTagFromNodeLabel = (label: string): string | undefined => {
  const match = /^<([a-z][\w-]*)>$/i.exec(label);
  return match?.[1]?.toLowerCase();
};

const LIST_CONTAINER_TAGS = new Set(["ul", "ol", "menu"]);
const TABLE_BODY_TAGS = new Set(["tbody", "thead", "tfoot"]);

const annotateHtmlLoopContainer = (
  parentNode: LogicGraphNode,
  sourceExpr: string,
  itemName: string | undefined
): void => {
  if (!parentNode.metadata?.isHtml) {
    return;
  }
  const tag = htmlTagFromNodeLabel(parentNode.label);
  if (!tag) {
    return;
  }
  if (LIST_CONTAINER_TAGS.has(tag)) {
    parentNode.metadata = {
      ...parentNode.metadata,
      htmlListItem: itemName,
      htmlListSource: sourceExpr,
      htmlRenderKind: "array-map",
    };
    return;
  }
  if (TABLE_BODY_TAGS.has(tag)) {
    parentNode.metadata = {
      ...parentNode.metadata,
      htmlListItem: itemName,
      htmlListSource: sourceExpr,
      htmlRenderKind: "table-rows",
    };
  }
};

const annotateHtmlLoopChild = (
  htmlNode: LogicGraphNode,
  loopParent: LogicGraphNode
): void => {
  const tag = htmlTagFromNodeLabel(htmlNode.label);
  if (!tag || loopParent.type !== "loop") {
    return;
  }
  const source = loopParent.loop?.sourceExpression;
  const item = loopParent.loop?.itemName;
  if (tag === "li") {
    htmlNode.metadata = {
      ...htmlNode.metadata,
      htmlListItem: item,
      htmlListSource: source,
      htmlRenderKind: "list-item",
    };
    return;
  }
  if (tag === "tr") {
    htmlNode.metadata = {
      ...htmlNode.metadata,
      htmlListItem: item,
      htmlListSource: source,
      htmlRenderKind: "table-row",
    };
  }
};

const shouldRunShallowPreview = (node: LogicGraphNode): boolean =>
  node.type === "component" && Boolean(node.importPath);

export const buildJsxCtx = (
  ctx: AnalyzeFunctionBodyContext,
  depth = 0
): AnalyzeJsxContext => ({
  config: ctx.config,
  depth,
  filePath: ctx.filePath,
  graph: ctx.graph,
  imports: ctx.imports,
  sourceFile: ctx.project?.getSourceFile(ctx.filePath),
});

const classifyPropExpression = (expression: string): PropKind => {
  if (
    expression.startsWith('"') ||
    expression.startsWith("'") ||
    expression === "true" ||
    expression === "false" ||
    /^-?\d/.test(expression)
  ) {
    return "literal";
  }
  if (expression.includes(".")) {
    return "member-expression";
  }
  if (expression.startsWith("{") || expression.startsWith("[")) {
    return "object";
  }
  if (expression.includes("=>") || expression.startsWith("function")) {
    return "function";
  }
  if (/^[a-zA-Z_$][\w$]*$/.test(expression)) {
    return "identifier";
  }
  return "unknown";
};

export const analyzeJsxProps = (
  node: JsxElement | JsxSelfClosingElement,
  filePath?: string
): PropUsage[] => {
  const props: PropUsage[] = [];

  for (const attribute of getJsxAttributes(node)) {
    const name = attribute.getNameNode().getText();
    const initializer = attribute.getInitializer();
    const attrLoc = filePath
      ? getSourceLocation(attribute, filePath)
      : undefined;

    if (!initializer) {
      props.push({
        expression: "true",
        kind: "literal",
        loc: attrLoc,
        name,
      });
      continue;
    }

    if (initializer.isKind(SyntaxKind.StringLiteral)) {
      props.push({
        expression: getNodeText(initializer),
        kind: "literal",
        loc: filePath ? getSourceLocation(initializer, filePath) : attrLoc,
        name,
      });
      continue;
    }

    if (initializer.isKind(SyntaxKind.JsxExpression)) {
      const expr = initializer.getExpression();
      const expression = expr ? getNodeText(expr) : "";
      props.push({
        expression,
        kind: classifyPropExpression(expression),
        loc: filePath ? getSourceLocation(initializer, filePath) : attrLoc,
        name,
      });
    }
  }

  return props;
};

const attachSameFileLocals = (
  componentNode: LogicGraphNode,
  tagName: string,
  ctx: AnalyzeJsxContext
): void => {
  if (!ctx.sourceFile) {
    return;
  }
  const definition = findComponentByName(ctx.sourceFile, tagName);
  if (!definition?.body) {
    return;
  }
  componentNode.locals = analyzeFunctionLocals({
    body: definition.body,
    ctx: {
      config: ctx.config,
      filePath: ctx.filePath,
      graph: ctx.graph,
      imports: ctx.imports,
      parentNode: componentNode,
    },
    propNames: definition.propNames ?? [],
  });
};

const createComponentNode = (
  tagName: string,
  node: JsxElement | JsxSelfClosingElement,
  ctx: AnalyzeJsxContext
): LogicGraphNode => {
  const importInfo = findImportForIdentifier(ctx.imports, tagName);
  const loc = getSourceLocation(node, ctx.filePath);

  const componentNode: LogicGraphNode = {
    filePath: importInfo?.resolvedPath,
    id: createNodeId({
      column: loc.startColumn,
      filePath: ctx.filePath,
      line: loc.startLine,
      name: tagName,
      type: "component",
    }),
    importPath: importInfo?.moduleSpecifier,
    label: tagName,
    loc,
    packageName: importInfo?.packageName,
    props: analyzeJsxProps(node, ctx.filePath),
    type: "component",
  };

  attachSameFileLocals(componentNode, tagName, ctx);
  return componentNode;
};

export const analyzeJsx = (
  node: Node,
  parentNode: LogicGraphNode,
  ctx: AnalyzeJsxContext
): void => {
  if (ctx.depth >= ctx.config.maxDepth) {
    ctx.graph.addWarning({
      code: "MAX_DEPTH_REACHED",
      filePath: ctx.filePath,
      message: `Max depth ${ctx.config.maxDepth} reached while analyzing JSX`,
    });
    return;
  }

  if (node.isKind(SyntaxKind.JsxExpression)) {
    const expr = node.getExpression();
    if (expr) {
      analyzeExpression(expr, parentNode, ctx);
    }
    return;
  }

  const unwrapped = node;

  if (
    unwrapped.isKind(SyntaxKind.JsxElement) ||
    unwrapped.isKind(SyntaxKind.JsxSelfClosingElement)
  ) {
    const jsxNode = unwrapped as JsxElement | JsxSelfClosingElement;
    const tagName = getJsxTagName(jsxNode);

    if (ctx.config.ignoreComponents.includes(tagName)) {
      if (unwrapped.isKind(SyntaxKind.JsxElement)) {
        for (const child of getJsxChildren(unwrapped as JsxElement)) {
          analyzeJsx(child, parentNode, { ...ctx, depth: ctx.depth + 1 });
        }
      }
      return;
    }

    if (isReactComponentTag(tagName)) {
      const componentNode = createComponentNode(tagName, jsxNode, ctx);
      ctx.graph.addNode(componentNode);
      if (
        ctx.runShallowPreview &&
        shouldRunShallowPreview(componentNode) &&
        unwrapped.isKind(SyntaxKind.JsxSelfClosingElement)
      ) {
        ctx.runShallowPreview(componentNode, tagName);
      }
      ctx.graph.addEdge(
        parentNode.id,
        componentNode.id,
        ctx.edgeType ?? "renders",
        ctx.edgeLabel
      );

      if (unwrapped.isKind(SyntaxKind.JsxElement)) {
        analyzeUiContentInElement(unwrapped as JsxElement, componentNode, ctx);
        for (const child of getJsxChildren(unwrapped as JsxElement)) {
          analyzeJsx(child, componentNode, { ...ctx, depth: ctx.depth + 1 });
        }
      }
      return;
    }

    if (isHtmlElement(tagName) && shouldIncludeHtmlTag(tagName, ctx.config)) {
      const normalizedTag = tagName.toLowerCase();
      const semanticTier = semanticTierForTag(normalizedTag);
      const htmlPropsNode = unwrapped.isKind(SyntaxKind.JsxSelfClosingElement)
        ? (unwrapped as JsxSelfClosingElement)
        : (unwrapped.isKind(SyntaxKind.JsxElement)
          ? (unwrapped as JsxElement)
          : null);
      const htmlNode: LogicGraphNode = {
        id: createNodeId({
          column: getSourceLocation(jsxNode, ctx.filePath).startColumn,
          filePath: ctx.filePath,
          line: getSourceLocation(jsxNode, ctx.filePath).startLine,
          name: `<${tagName}>`,
          type: "component",
        }),
        label: `<${tagName}>`,
        loc: getSourceLocation(jsxNode, ctx.filePath),
        metadata: {
          htmlTextContent: unwrapped.isKind(SyntaxKind.JsxElement)
            ? extractHtmlTextPreview(unwrapped as JsxElement)
            : undefined,
          isHtml: true,
          isHtmlWrapper: isHtmlLayoutWrapperTag(normalizedTag),
          isSemanticHtml: isSemanticHtmlTag(normalizedTag),
          semanticTier,
        },
        props: htmlPropsNode
          ? analyzeJsxProps(htmlPropsNode, ctx.filePath)
          : undefined,
        type: "component",
      };
      if (parentNode.type === "loop") {
        annotateHtmlLoopChild(htmlNode, parentNode);
      }
      ctx.graph.addNode(htmlNode);
      ctx.graph.addEdge(
        parentNode.id,
        htmlNode.id,
        ctx.edgeType ?? "renders",
        ctx.edgeLabel
      );

      if (unwrapped.isKind(SyntaxKind.JsxElement)) {
        for (const child of getJsxChildren(unwrapped as JsxElement)) {
          analyzeJsx(child, htmlNode, { ...ctx, depth: ctx.depth + 1 });
        }
      }
      return;
    }

    if (unwrapped.isKind(SyntaxKind.JsxElement)) {
      for (const child of getJsxChildren(unwrapped as JsxElement)) {
        analyzeJsx(child, parentNode, { ...ctx, depth: ctx.depth + 1 });
      }
    }
    return;
  }

  if (unwrapped.isKind(SyntaxKind.JsxFragment)) {
    for (const child of getJsxChildren(unwrapped as JsxFragment)) {
      analyzeJsx(child, parentNode, { ...ctx, depth: ctx.depth + 1 });
    }
    return;
  }
};

export const analyzeExpression = (
  expr: Node,
  parentNode: LogicGraphNode,
  ctx: AnalyzeJsxContext
): void => {
  if (expr.isKind(SyntaxKind.ParenthesizedExpression)) {
    analyzeExpression(expr.getExpression(), parentNode, ctx);
    return;
  }

  if (expr.isKind(SyntaxKind.BinaryExpression)) {
    const binary = expr as BinaryExpression;
    if (
      binary.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken
    ) {
      const conditionExpr = getNodeText(binary.getLeft());
      const conditionNode: LogicGraphNode = {
        condition: { expression: conditionExpr, kind: "logical-and" },
        id: createNodeId({
          column: getSourceLocation(binary, ctx.filePath).startColumn,
          filePath: ctx.filePath,
          line: getSourceLocation(binary, ctx.filePath).startLine,
          name: conditionExpr,
          type: "condition",
        }),
        label: conditionExpr,
        loc: getSourceLocation(binary, ctx.filePath),
        type: "condition",
      };
      ctx.graph.addNode(conditionNode);
      ctx.graph.addEdge(parentNode.id, conditionNode.id, "renders");
      analyzeExpression(binary.getRight(), conditionNode, {
        ...ctx,
        depth: ctx.depth + 1,
      });
      return;
    }
  }

  if (expr.isKind(SyntaxKind.ConditionalExpression)) {
    const ternary = expr as ConditionalExpression;
    const conditionExpr = getNodeText(ternary.getCondition());
    const conditionNode: LogicGraphNode = {
      condition: { expression: conditionExpr, kind: "ternary" },
      id: createNodeId({
        column: getSourceLocation(ternary, ctx.filePath).startColumn,
        filePath: ctx.filePath,
        line: getSourceLocation(ternary, ctx.filePath).startLine,
        name: conditionExpr,
        type: "condition",
      }),
      label: conditionExpr,
      loc: getSourceLocation(ternary, ctx.filePath),
      type: "condition",
    };
    ctx.graph.addNode(conditionNode);
    ctx.graph.addEdge(parentNode.id, conditionNode.id, "renders");

    analyzeExpression(ternary.getWhenTrue(), conditionNode, {
      ...ctx,
      depth: ctx.depth + 1,
      edgeLabel: "true",
      edgeType: "condition-true",
    });

    analyzeExpression(ternary.getWhenFalse(), conditionNode, {
      ...ctx,
      depth: ctx.depth + 1,
      edgeLabel: "false",
      edgeType: "condition-false",
    });
    return;
  }

  if (expr.isKind(SyntaxKind.CallExpression)) {
    const call = expr as CallExpression;
    const expression = call.getExpression();

    if (
      expression.isKind(SyntaxKind.PropertyAccessExpression) &&
      expression.getName() === "map"
    ) {
      const sourceExpr = getNodeText(expression.getExpression());
      const callback = call.getArguments()[0];
      let itemName: string | undefined;

      if (
        callback?.isKind(SyntaxKind.ArrowFunction) ||
        callback?.isKind(SyntaxKind.FunctionExpression)
      ) {
        const params = callback.getParameters();
        itemName = params[0]?.getName();
      }

      const loopNode: LogicGraphNode = {
        id: createNodeId({
          column: getSourceLocation(call, ctx.filePath).startColumn,
          filePath: ctx.filePath,
          line: getSourceLocation(call, ctx.filePath).startLine,
          name: `${sourceExpr}.map(${itemName ?? "item"})`,
          type: "loop",
        }),
        label: `${sourceExpr}.map(${itemName ?? "item"})`,
        loc: getSourceLocation(call, ctx.filePath),
        loop: {
          itemName,
          kind: "map",
          sourceExpression: sourceExpr,
        },
        type: "loop",
      };
      ctx.graph.addNode(loopNode);
      ctx.graph.addEdge(
        parentNode.id,
        loopNode.id,
        ctx.edgeType ?? "renders",
        ctx.edgeLabel
      );
      annotateHtmlLoopContainer(parentNode, sourceExpr, itemName);

      if (
        callback?.isKind(SyntaxKind.ArrowFunction) ||
        callback?.isKind(SyntaxKind.FunctionExpression)
      ) {
        const body = callback.getBody();
        if (body) {
          analyzeExpression(body, loopNode, {
            ...ctx,
            depth: ctx.depth + 1,
            edgeType: "loop-renders",
          });
        }
      }
      return;
    }
  }

  if (expr.isKind(SyntaxKind.Identifier) && expr.getText() === "children") {
    const slotNode: LogicGraphNode = {
      id: createNodeId({
        column: getSourceLocation(expr, ctx.filePath).startColumn,
        filePath: ctx.filePath,
        line: getSourceLocation(expr, ctx.filePath).startLine,
        name: "{children}",
        type: "slot",
      }),
      label: "{children}",
      loc: getSourceLocation(expr, ctx.filePath),
      metadata: { category: "ui", slotKind: "children" },
      type: "slot",
    };
    ctx.graph.addNode(slotNode);
    ctx.graph.addEdge(
      parentNode.id,
      slotNode.id,
      ctx.edgeType ?? "renders",
      ctx.edgeLabel ?? "children"
    );
    return;
  }

  if (expr.isKind(SyntaxKind.NullKeyword)) {
    return;
  }

  if (isJsxStructure(expr)) {
    analyzeJsx(expr, parentNode, ctx);
    return;
  }

  if (expr.isKind(SyntaxKind.ParenthesizedExpression)) {
    analyzeExpression(expr.getExpression(), parentNode, ctx);
  }
};
