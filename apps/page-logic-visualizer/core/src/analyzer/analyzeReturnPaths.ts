import type {
  IfStatement,
  Node,
  ReturnStatement,
  Statement,
  SwitchStatement,
} from "ts-morph";
import { SyntaxKind } from "ts-morph";

import { createNodeId } from "../graph/createGraph";
import type { LogicGraphNode, SourceLocation } from "../types";
import {
  extractExpressionInputs,
  getBranchLabel,
  getNodeText,
  getSourceLocation,
  isJsxStructure,
  unwrapExpression,
} from "../utils/ast";
import type { AnalyzeFunctionBodyContext } from "./analyzeFunctionBody";
import { analyzeExpression, analyzeJsx, buildJsxCtx } from "./analyzeJsx";
import type { AnalyzeJsxContext } from "./analyzeJsx";

interface ReachabilityGate {
  expression: string;
  branch: "true" | "false";
  inputs: string[];
  loc: SourceLocation;
}

interface ReturnPathContext {
  bodyCtx: AnalyzeFunctionBodyContext;
  jsxCtx: AnalyzeJsxContext;
  handledReturns: { value: boolean };
  conditionNodesByKey: Map<string, LogicGraphNode>;
}

const conditionCacheKey = (expression: string, loc: SourceLocation): string =>
  `${expression}:${loc.startLine}:${loc.startColumn}`;

const getOrCreateConditionNode = (
  expression: string,
  loc: SourceLocation,
  inputs: string[],
  trueOutput: string,
  falseOutput: string,
  ctx: ReturnPathContext
): LogicGraphNode => {
  const cacheKey = conditionCacheKey(expression, loc);
  const cached = ctx.conditionNodesByKey.get(cacheKey);
  if (cached) {
    return cached;
  }

  const conditionNode: LogicGraphNode = {
    condition: {
      expression,
      falseOutput,
      inputs,
      kind: "if-return",
      trueOutput,
    },
    id: createNodeId({
      column: loc.startColumn,
      filePath: ctx.bodyCtx.filePath,
      line: loc.startLine,
      name: expression,
      type: "condition",
    }),
    label: expression,
    loc,
    metadata: { category: "logic" },
    type: "condition",
  };

  ctx.bodyCtx.graph.addNode(conditionNode);
  ctx.bodyCtx.graph.addEdge(
    ctx.bodyCtx.parentNode.id,
    conditionNode.id,
    "renders"
  );
  ctx.conditionNodesByKey.set(cacheKey, conditionNode);
  return conditionNode;
};

const combineGates = (gates: ReachabilityGate[]): string =>
  gates
    .map((gate) =>
      gate.branch === "true" ? `(${gate.expression})` : `!(${gate.expression})`
    )
    .join(" && ");

const createGateFromCondition = (
  expression: string,
  loc: SourceLocation,
  branch: "true" | "false"
): ReachabilityGate => ({
  branch,
  expression,
  inputs: extractExpressionInputs(expression),
  loc,
});

const renderReturnExpression = (
  expression: Node,
  parentNode: LogicGraphNode,
  jsxCtx: AnalyzeJsxContext,
  edgeType?: AnalyzeJsxContext["edgeType"],
  edgeLabel?: string
): void => {
  const unwrapped = unwrapExpression(expression);
  const nextCtx = { ...jsxCtx, edgeLabel, edgeType };

  if (isJsxStructure(unwrapped)) {
    analyzeJsx(unwrapped, parentNode, nextCtx);
    return;
  }

  analyzeExpression(unwrapped, parentNode, nextCtx);
};

const handleReturnWithGates = (
  returnStatement: ReturnStatement,
  gates: ReachabilityGate[],
  ctx: ReturnPathContext
): void => {
  const expression = returnStatement.getExpression();
  if (!expression) {
    return;
  }

  ctx.handledReturns.value = true;
  const { bodyCtx, jsxCtx } = ctx;

  if (gates.length === 0) {
    renderReturnExpression(expression, bodyCtx.parentNode, jsxCtx);
    return;
  }

  const unwrapped = unwrapExpression(expression);
  const branchLabel = getBranchLabel(unwrapped);

  if (gates.length === 1) {
    const gate = gates[0]!;
    const conditionNode = getOrCreateConditionNode(
      gate.expression,
      gate.loc,
      gate.inputs,
      gate.branch === "true" ? branchLabel : "null (render nothing)",
      gate.branch === "true" ? "null (render nothing)" : branchLabel,
      ctx
    );

    renderReturnExpression(
      expression,
      conditionNode,
      jsxCtx,
      gate.branch === "true" ? "condition-true" : "condition-false",
      gate.branch
    );
    return;
  }

  const combinedExpression = combineGates(gates);
  const combinedInputs = extractExpressionInputs(combinedExpression);
  const loc = getSourceLocation(returnStatement, bodyCtx.filePath);

  const conditionNode: LogicGraphNode = {
    condition: {
      expression: combinedExpression,
      falseOutput: "null (render nothing)",
      inputs: combinedInputs,
      kind: "if-return",
      trueOutput: branchLabel,
    },
    id: createNodeId({
      column: loc.startColumn,
      filePath: bodyCtx.filePath,
      line: loc.startLine,
      name: combinedExpression,
      type: "condition",
    }),
    label: combinedExpression,
    loc,
    metadata: { category: "logic" },
    type: "condition",
  };

  bodyCtx.graph.addNode(conditionNode);
  bodyCtx.graph.addEdge(bodyCtx.parentNode.id, conditionNode.id, "renders");

  renderReturnExpression(
    expression,
    conditionNode,
    jsxCtx,
    "condition-true",
    "true"
  );
};

const analyzeIfStatement = (
  statement: IfStatement,
  gates: ReachabilityGate[],
  ctx: ReturnPathContext
): ReachabilityGate[] => {
  const conditionNode = statement.getExpression();
  const conditionExpression = getNodeText(conditionNode);
  const conditionLoc = getSourceLocation(conditionNode, ctx.bodyCtx.filePath);
  const trueGate = createGateFromCondition(
    conditionExpression,
    conditionLoc,
    "true"
  );
  const falseGate = createGateFromCondition(
    conditionExpression,
    conditionLoc,
    "false"
  );

  analyzeStatementOrBlock(
    statement.getThenStatement(),
    [...gates, trueGate],
    ctx
  );

  const elseStatement = statement.getElseStatement();
  if (elseStatement) {
    analyzeStatementOrBlock(elseStatement, [...gates, falseGate], ctx);
    return gates;
  }

  return [...gates, falseGate];
};

const analyzeSwitchStatement = (
  statement: SwitchStatement,
  gates: ReachabilityGate[],
  ctx: ReturnPathContext
): void => {
  const discriminant = getNodeText(statement.getExpression());
  const caseMatchExpressions: string[] = [];

  for (const clause of statement.getCaseBlock().getClauses()) {
    if (clause.isKind(SyntaxKind.CaseClause)) {
      const caseExpression = clause.getExpression();
      const caseText = caseExpression
        ? getNodeText(caseExpression)
        : "undefined";
      const matchExpression = `${discriminant} === ${caseText}`;
      caseMatchExpressions.push(matchExpression);

      const caseLoc = caseExpression
        ? getSourceLocation(caseExpression, ctx.bodyCtx.filePath)
        : getSourceLocation(clause, ctx.bodyCtx.filePath);
      const caseGate = createGateFromCondition(
        matchExpression,
        caseLoc,
        "true"
      );

      for (const caseStatement of clause.getStatements()) {
        analyzeStatementOrBlock(caseStatement, [...gates, caseGate], ctx);
      }
      continue;
    }

    if (clause.isKind(SyntaxKind.DefaultClause)) {
      const defaultExpression =
        caseMatchExpressions.length > 0
          ? `!(${caseMatchExpressions.join(" || ")})`
          : "true";
      const defaultLoc = getSourceLocation(clause, ctx.bodyCtx.filePath);
      const defaultGate = createGateFromCondition(
        defaultExpression,
        defaultLoc,
        "true"
      );

      for (const defaultStatement of clause.getStatements()) {
        analyzeStatementOrBlock(defaultStatement, [...gates, defaultGate], ctx);
      }
    }
  }
};

const analyzeStatementOrBlock = (
  node: Node,
  gates: ReachabilityGate[],
  ctx: ReturnPathContext
): void => {
  if (node.isKind(SyntaxKind.Block)) {
    analyzeBlock(node.getStatements(), gates, ctx);
    return;
  }

  if (node.isKind(SyntaxKind.ReturnStatement)) {
    handleReturnWithGates(node, gates, ctx);
    return;
  }

  if (node.isKind(SyntaxKind.IfStatement)) {
    analyzeBlock([node], gates, ctx);
    return;
  }

  if (node.isKind(SyntaxKind.SwitchStatement)) {
    analyzeSwitchStatement(node, gates, ctx);
  }
};

const analyzeBlock = (
  statements: Statement[],
  gates: ReachabilityGate[],
  ctx: ReturnPathContext
): void => {
  let currentGates = gates;

  for (const statement of statements) {
    if (statement.isKind(SyntaxKind.ReturnStatement)) {
      handleReturnWithGates(statement, currentGates, ctx);
      continue;
    }

    if (statement.isKind(SyntaxKind.IfStatement)) {
      currentGates = analyzeIfStatement(statement, currentGates, ctx);
      continue;
    }

    if (statement.isKind(SyntaxKind.SwitchStatement)) {
      analyzeSwitchStatement(statement, currentGates, ctx);
      continue;
    }

    if (statement.isKind(SyntaxKind.Block)) {
      analyzeBlock(statement.getStatements(), currentGates, ctx);
    }
  }
};

export const analyzeReturnPaths = (
  body: Node | undefined,
  ctx: AnalyzeFunctionBodyContext,
  options?: { depth?: number }
): boolean => {
  if (!body) {
    return false;
  }

  const jsxCtx = buildJsxCtx(ctx, options?.depth ?? 0);

  const pathCtx: ReturnPathContext = {
    bodyCtx: ctx,
    conditionNodesByKey: new Map(),
    handledReturns: { value: false },
    jsxCtx,
  };

  if (
    body.isKind(SyntaxKind.JsxElement) ||
    body.isKind(SyntaxKind.JsxFragment) ||
    body.isKind(SyntaxKind.JsxSelfClosingElement)
  ) {
    analyzeJsx(body, ctx.parentNode, jsxCtx);
    return true;
  }

  if (body.isKind(SyntaxKind.Block)) {
    analyzeBlock(body.getStatements(), [], pathCtx);
    return pathCtx.handledReturns.value;
  }

  if (body.isKind(SyntaxKind.ParenthesizedExpression)) {
    return analyzeReturnPaths(body.getExpression(), ctx, options);
  }

  renderReturnExpression(body, ctx.parentNode, jsxCtx);
  return true;
};
