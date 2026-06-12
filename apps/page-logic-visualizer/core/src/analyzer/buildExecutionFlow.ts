import type {
  CallExpression,
  Node,
  Project,
  Statement,
  TryStatement,
} from "ts-morph";
import { SyntaxKind } from "ts-morph";

import type {
  DataFetchCallTreeNode,
  ExecutionFlowBranch,
  ExecutionFlowStep,
  ImportInfo,
  SourceLocation,
} from "../types";
import { getNodeText, getSourceLocation } from "../utils/ast";
import { findImportForIdentifier } from "./analyzeImports";
import { resolveFunctionReturnType } from "./resolveFunctionReturnType";

export interface ExecutionFlowBuildContext {
  fieldPath?: string;
  fileImports: ImportInfo[];
  filePath: string;
  idPrefix: string;
  imports: ImportInfo[];
  project?: Project;
  resolveNestedCallTree: (
    functionName: string,
    resolvedFilePath?: string
  ) => DataFetchCallTreeNode[] | undefined;
  resolveNestedFlow: (
    functionName: string,
    resolvedFilePath?: string
  ) => ExecutionFlowStep[] | undefined;
}

let flowIdCounter = 0;
const nextFlowId = (prefix: string): string => {
  flowIdCounter += 1;
  return `${prefix}:${flowIdCounter}`;
};

const resetFlowIds = (): void => {
  flowIdCounter = 0;
};

const extractFieldExpression = (
  node: Node | undefined,
  fieldPath: string | undefined,
  filePath: string
):
  | { expression: string; isLiteral: boolean; loc?: SourceLocation }
  | undefined => {
  if (!node || !fieldPath) {
    return undefined;
  }

  const rootField = fieldPath.split(".")[0] ?? fieldPath;

  if (node.isKind(SyntaxKind.ObjectLiteralExpression)) {
    for (const property of node.getProperties()) {
      if (!property.isKind(SyntaxKind.PropertyAssignment)) {
        continue;
      }
      const key = property.getName().replaceAll(/^["']|["']$/g, "");
      if (key !== rootField && fieldPath !== key) {
        if (fieldPath.startsWith(`${key}.`)) {
          const nested = property.getInitializer();
          const rest = fieldPath.slice(key.length + 1);
          return extractFieldExpression(nested, rest, filePath);
        }
        continue;
      }
      const initializer = property.getInitializer();
      if (!initializer) {
        return undefined;
      }
      const text = getNodeText(initializer);
      const isLiteral =
        initializer.isKind(SyntaxKind.StringLiteral) ||
        initializer.isKind(SyntaxKind.NumericLiteral) ||
        initializer.isKind(SyntaxKind.TrueKeyword) ||
        initializer.isKind(SyntaxKind.FalseKeyword) ||
        initializer.isKind(SyntaxKind.NullKeyword);
      return {
        expression: text,
        isLiteral,
        loc: getSourceLocation(property, filePath),
      };
    }
    return undefined;
  }

  return {
    expression: getNodeText(node),
    isLiteral: false,
    loc: getSourceLocation(node, filePath),
  };
};

const propOutcomeLabel = (
  fieldPath: string | undefined,
  expression: string,
  isLiteral: boolean
): string | undefined => {
  if (!fieldPath) {
    return undefined;
  }
  return isLiteral
    ? `${fieldPath} = ${expression} (literal on this path)`
    : `${fieldPath} ← ${expression}`;
};

const isPromiseAllCall = (call: CallExpression): boolean => {
  const expr = call.getExpression();
  return (
    expr.isKind(SyntaxKind.PropertyAccessExpression) &&
    expr.getName() === "all" &&
    expr.getExpression().getText() === "Promise"
  );
};

const findMatchingCallTreeNode = (
  call: CallExpression,
  callTreeNodes: DataFetchCallTreeNode[]
): DataFetchCallTreeNode | undefined => {
  if (isPromiseAllCall(call)) {
    return callTreeNodes.find((node) => node.kind === "promise-all");
  }
  const expr = call.getExpression();
  if (expr.isKind(SyntaxKind.Identifier)) {
    return callTreeNodes.find((node) => node.functionName === expr.getText());
  }
  return undefined;
};

const buildCollapsedParallelCallStep = (
  node: DataFetchCallTreeNode,
  ctx: ExecutionFlowBuildContext,
  depth: number
): ExecutionFlowStep => {
  const detailSteps =
    node.kind === "api"
      ? callTreeNodeToSteps(node, ctx, depth + 1)
      : node.children.length > 0
        ? node.children.flatMap((child) =>
            callTreeNodeToSteps(child, ctx, depth + 1)
          )
        : node.functionName && node.resolvedFilePath
          ? (ctx.resolveNestedFlow(node.functionName, node.resolvedFilePath) ??
            [])
          : [];

  return {
    expandableSteps: detailSteps.length > 0 ? detailSteps : undefined,
    functionName: node.functionName,
    id: nextFlowId(`${ctx.idPrefix}:${node.functionName ?? node.kind}:call`),
    kind: node.kind === "api" ? "await-call" : "call",
    label: node.label,
    loc: node.callSiteLoc ?? node.definitionLoc,
    narrative:
      node.kind === "api"
        ? "HTTP request — click show on the edge to trace fetch → response"
        : `${node.label} — click show to expand fetch → data inside`,
    resolvedFilePath: node.resolvedFilePath,
    returnType: node.returnType,
  };
};

const callTreeNodeToSteps = (
  node: DataFetchCallTreeNode,
  ctx: ExecutionFlowBuildContext,
  depth = 0
): ExecutionFlowStep[] => {
  const steps: ExecutionFlowStep[] = [];
  const id = nextFlowId(`${ctx.idPrefix}:${node.functionName ?? node.kind}`);

  if (node.kind === "promise-all") {
    steps.push({
      awaited: true,
      id,
      kind: "parallel-fork",
      label: node.label,
      loc: node.callSiteLoc,
      narrative:
        "await Promise.all — every call starts now; execution waits until all branches settle",
      parallelBranches: node.children.map((child) => [
        buildCollapsedParallelCallStep(child, ctx, depth + 1),
      ]),
    });
    steps.push({
      id: nextFlowId(`${id}:join`),
      kind: "parallel-join",
      label: "Await",
      narrative:
        "Promise.all settled — every parallel call finished; results are ready for the next line",
    });
    return steps;
  }

  if (node.kind === "api") {
    steps.push({
      id,
      kind: "await-call",
      label: node.label,
      loc: node.callSiteLoc,
      narrative:
        "Network request — async I/O runs until the fetch promise settles",
    });
    return steps;
  }

  const { functionName } = node;
  const nestedFlow =
    functionName && node.resolvedFilePath
      ? ctx.resolveNestedFlow(functionName, node.resolvedFilePath)
      : undefined;
  const nestedCallTree =
    functionName && node.resolvedFilePath
      ? ctx.resolveNestedCallTree(functionName, node.resolvedFilePath)
      : node.children;

  const bodySteps =
    nestedFlow ??
    (nestedCallTree?.length
      ? nestedCallTree.flatMap((child) =>
          callTreeNodeToSteps(child, ctx, depth + 1)
        )
      : undefined);

  const enterStep: ExecutionFlowStep = {
    awaited: node.awaited,
    expandableSteps: bodySteps?.length ? bodySteps : undefined,
    functionName,
    id,
    kind: node.awaited ? "await-call" : "call",
    label: node.label,
    loc: node.definitionLoc ?? node.callSiteLoc,
    narrative: node.awaited
      ? `await ${node.label} — click show to expand the function body`
      : `${node.label} — click show to expand internal steps`,
    resolvedFilePath: node.resolvedFilePath,
    returnType: node.returnType,
  };
  steps.push(enterStep);

  if (node.awaited || node.isAsync) {
    steps.push({
      id: nextFlowId(`${id}:resume`),
      kind: "resume",
      label: `← ${functionName ?? "call"} returned`,
      narrative: functionName
        ? `${functionName}() finished — caller receives the return value and continues`
        : "Callee returned — execution resumes in the caller",
      returnType: node.returnType,
    });
  }

  return steps;
};

const buildCallStepFromExpression = (
  call: CallExpression,
  awaited: boolean,
  ctx: ExecutionFlowBuildContext,
  callTreeNodes: DataFetchCallTreeNode[]
): ExecutionFlowStep[] => {
  if (isPromiseAllCall(call)) {
    const matchingTree = findMatchingCallTreeNode(call, callTreeNodes);
    if (matchingTree) {
      return callTreeNodeToSteps(matchingTree, ctx);
    }
  }

  const expression = call.getExpression();
  if (!expression.isKind(SyntaxKind.Identifier)) {
    return [];
  }

  const functionName = expression.getText();
  const matchingTree = findMatchingCallTreeNode(call, callTreeNodes);

  if (matchingTree) {
    return callTreeNodeToSteps(matchingTree, ctx);
  }

  const id = nextFlowId(`${ctx.idPrefix}:${functionName}`);
  const importInfo = findImportForIdentifier(ctx.fileImports, functionName);
  const nestedBody = ctx.resolveNestedFlow(
    functionName,
    importInfo?.resolvedPath
  );
  return [
    {
      awaited,
      expandableSteps: nestedBody?.length ? nestedBody : undefined,
      functionName,
      id,
      kind: awaited ? "await-call" : "call",
      label: `${functionName}()`,
      loc: getSourceLocation(call, ctx.filePath),
      narrative: awaited
        ? `await ${functionName}() — click show to expand`
        : `${functionName}() — click show to expand`,
      resolvedFilePath: importInfo?.resolvedPath,
    },
    ...(awaited
      ? [
          {
            id: nextFlowId(`${id}:resume`),
            kind: "resume" as const,
            label: `← ${functionName}() returned`,
            narrative: `${functionName}() completed — caller continues with the return value`,
          },
        ]
      : []),
  ];
};

const buildReturnStep = (
  expression: Node | undefined,
  ctx: ExecutionFlowBuildContext
): ExecutionFlowStep | undefined => {
  if (!expression) {
    return undefined;
  }

  const fieldInfo = extractFieldExpression(
    expression,
    ctx.fieldPath,
    ctx.filePath
  );

  if (expression.isKind(SyntaxKind.CallExpression)) {
    const innerSteps = buildCallStepFromExpression(expression, false, ctx, []);
    return {
      id: nextFlowId(`${ctx.idPrefix}:return`),
      kind: "return",
      label: `return ${getNodeText(expression)}`,
      loc: getSourceLocation(expression, ctx.filePath),
      narrative:
        "Return to caller — the object/expression becomes the function result",
      propOutcome: fieldInfo
        ? propOutcomeLabel(
            ctx.fieldPath,
            fieldInfo.expression,
            fieldInfo.isLiteral
          )
        : undefined,
      steps: innerSteps.length > 0 ? innerSteps : undefined,
    };
  }

  return {
    id: nextFlowId(`${ctx.idPrefix}:return`),
    kind: "return",
    label: `return ${getNodeText(expression).slice(0, 80)}`,
    loc: getSourceLocation(expression, ctx.filePath),
    narrative: "Return to caller with this value",
    propOutcome: fieldInfo
      ? propOutcomeLabel(
          ctx.fieldPath,
          fieldInfo.expression,
          fieldInfo.isLiteral
        )
      : undefined,
  };
};

const buildTryCatchBranch = (
  statement: TryStatement,
  ctx: ExecutionFlowBuildContext,
  callTreeNodes: DataFetchCallTreeNode[]
): ExecutionFlowStep => {
  const trySteps = buildStatementFlow(
    statement.getTryBlock().getStatements(),
    ctx,
    callTreeNodes
  );
  const catchClause = statement.getCatchClause();
  const catchSteps = catchClause
    ? buildStatementFlow(
        catchClause.getBlock().getStatements(),
        ctx,
        callTreeNodes
      )
    : [];

  const tryReturnField = findReturnFieldInSteps(trySteps, ctx);
  const catchReturnField = findReturnFieldInSteps(catchSteps, ctx);

  const branches: ExecutionFlowBranch[] = [
    {
      branchKind: "try",
      description:
        "Happy path — no throw; nested fetches/transforms run normally",
      id: nextFlowId(`${ctx.idPrefix}:try`),
      label: "Try",
      narrative: tryReturnField?.propOutcome
        ? `Success → ${tryReturnField.propOutcome}`
        : "API/transform path succeeds",
      propOutcome: tryReturnField?.propOutcome,
      steps: trySteps,
    },
  ];

  if (catchSteps.length > 0 || catchClause) {
    branches.push({
      branchKind: "catch",
      description:
        "Error path — any throw in try jumps here; fallback values are used",
      id: nextFlowId(`${ctx.idPrefix}:catch`),
      label: "Catch",
      narrative: catchReturnField?.propOutcome
        ? `On error → ${catchReturnField.propOutcome}`
        : "Fallback return when try block throws",
      propOutcome: catchReturnField?.propOutcome,
      steps: catchSteps,
    });
  }

  return {
    branches,
    id: nextFlowId(`${ctx.idPrefix}:try-catch`),
    kind: "branch",
    label: "try { … } catch { … }",
    loc: getSourceLocation(statement, ctx.filePath),
    narrative:
      "Runtime picks ONE path: try runs on success, catch runs if anything throws",
  };
};

const findReturnFieldInSteps = (
  steps: ExecutionFlowStep[],
  ctx: ExecutionFlowBuildContext
): ExecutionFlowStep | undefined => {
  for (const step of steps) {
    if (step.propOutcome) {
      return step;
    }
    if (step.steps) {
      const nested = findReturnFieldInSteps(step.steps, ctx);
      if (nested) {
        return nested;
      }
    }
    if (step.branches) {
      for (const branch of step.branches) {
        const nested = findReturnFieldInSteps(branch.steps, ctx);
        if (nested) {
          return nested;
        }
      }
    }
  }
  return undefined;
};

const buildStatementFlow = (
  statements: Statement[],
  ctx: ExecutionFlowBuildContext,
  callTreeNodes: DataFetchCallTreeNode[]
): ExecutionFlowStep[] => {
  const steps: ExecutionFlowStep[] = [];

  for (const statement of statements) {
    if (statement.isKind(SyntaxKind.TryStatement)) {
      steps.push(buildTryCatchBranch(statement, ctx, callTreeNodes));
      continue;
    }

    if (statement.isKind(SyntaxKind.IfStatement)) {
      const condition = getNodeText(statement.getExpression());
      const thenSteps = buildStatementFlow(
        statement.getThenStatement().isKind(SyntaxKind.Block)
          ? statement.getThenStatement().getStatements()
          : [statement.getThenStatement()],
        ctx,
        callTreeNodes
      );
      const elseStatement = statement.getElseStatement();
      const elseSteps = elseStatement
        ? buildStatementFlow(
            elseStatement.isKind(SyntaxKind.Block)
              ? elseStatement.getStatements()
              : [elseStatement],
            ctx,
            callTreeNodes
          )
        : [];

      if (thenSteps.length > 0 || elseSteps.length > 0) {
        const branches: ExecutionFlowBranch[] = [
          {
            branchKind: "if-true",
            description: `Runs when (${condition}) is truthy`,
            id: nextFlowId(`${ctx.idPrefix}:if-true`),
            label: `if (${condition})`,
            narrative: "Condition true — this branch executes",
            steps: thenSteps,
          },
        ];
        if (elseSteps.length > 0) {
          branches.push({
            branchKind: "if-false",
            description: `Runs when (${condition}) is falsy`,
            id: nextFlowId(`${ctx.idPrefix}:if-false`),
            label: "else",
            narrative: "Condition false — else branch executes",
            steps: elseSteps,
          });
        }
        steps.push({
          branches,
          id: nextFlowId(`${ctx.idPrefix}:if`),
          kind: "branch",
          label: `if (${condition})`,
          loc: getSourceLocation(statement, ctx.filePath),
          narrative: "Conditional — only one branch runs per invocation",
        });
      }
      continue;
    }

    if (statement.isKind(SyntaxKind.SwitchStatement)) {
      const discriminant = getNodeText(statement.getExpression());
      const branches: ExecutionFlowBranch[] = [];

      for (const clause of statement.getClauses()) {
        if (clause.isKind(SyntaxKind.DefaultClause)) {
          const defaultSteps = buildStatementFlow(
            clause.getStatements(),
            ctx,
            callTreeNodes
          );
          const defaultReturn = findReturnFieldInSteps(defaultSteps, ctx);
          branches.push({
            branchKind: "switch-default",
            description: "Runs when no case label matches",
            id: nextFlowId(`${ctx.idPrefix}:switch-default`),
            label: "default",
            narrative: defaultReturn?.propOutcome
              ? `Default path → ${defaultReturn.propOutcome}`
              : "Fallback when no case matches",
            propOutcome: defaultReturn?.propOutcome,
            steps: defaultSteps,
          });
          continue;
        }

        if (!clause.isKind(SyntaxKind.CaseClause)) {
          continue;
        }

        const caseLabel = clause.getExpression()
          ? getNodeText(clause.getExpression())
          : "?";
        const caseSteps = buildStatementFlow(
          clause.getStatements(),
          ctx,
          callTreeNodes
        );
        const caseReturn = findReturnFieldInSteps(caseSteps, ctx);
        branches.push({
          branchKind: "switch-case",
          description: `Runs when ${discriminant} === ${caseLabel}`,
          id: nextFlowId(`${ctx.idPrefix}:switch-${caseLabel}`),
          label: `case ${caseLabel}`,
          narrative: caseReturn?.propOutcome
            ? `This case → ${caseReturn.propOutcome}`
            : `Matched when ${discriminant} equals ${caseLabel}`,
          propOutcome: caseReturn?.propOutcome,
          steps: caseSteps,
        });
      }

      if (branches.length > 0) {
        steps.push({
          branches,
          id: nextFlowId(`${ctx.idPrefix}:switch`),
          kind: "branch",
          label: `switch (${discriminant})`,
          loc: getSourceLocation(statement, ctx.filePath),
          narrative:
            "Switch picks exactly one case (or default) per runtime value",
        });
      }
      continue;
    }

    let call: CallExpression | undefined;
    let awaited = false;

    const readCall = (expr: Node | undefined) => {
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
        if (call) {
          const callSteps = buildCallStepFromExpression(
            call,
            awaited,
            ctx,
            callTreeNodes
          );
          const expandableSteps = callSteps.filter(
            (step) => step.kind !== "resume"
          );
          const statementText = getNodeText(statement).trim().replace(/;$/, "");
          steps.push({
            expandableSteps:
              expandableSteps.length > 0 ? expandableSteps : undefined,
            functionName: expandableSteps[0]?.functionName,
            id: nextFlowId(`${ctx.idPrefix}:assign`),
            kind: "assign",
            label: statementText,
            loc: getSourceLocation(statement, ctx.filePath),
            narrative: `Assign — await completes and binds the result`,
            resolvedFilePath: expandableSteps[0]?.resolvedFilePath,
          });
        }
      }
      continue;
    }

    if (statement.isKind(SyntaxKind.ReturnStatement)) {
      const returnStep = buildReturnStep(statement.getExpression(), ctx);
      if (returnStep) {
        steps.push(returnStep);
      }
      continue;
    }

    if (statement.isKind(SyntaxKind.ExpressionStatement)) {
      readCall(statement.getExpression());
      if (call) {
        steps.push(
          ...buildCallStepFromExpression(call, awaited, ctx, callTreeNodes)
        );
      }
    }
  }

  return steps;
};

export const buildExecutionFlowFromBody = ({
  body,
  callTreeNodes,
  ctx,
}: {
  body: Node | undefined;
  callTreeNodes: DataFetchCallTreeNode[];
  ctx: ExecutionFlowBuildContext;
}): ExecutionFlowStep[] => {
  resetFlowIds();
  if (!body?.isKind(SyntaxKind.Block)) {
    return [];
  }
  return buildStatementFlow(body.getStatements(), ctx, callTreeNodes);
};

export const executionFlowToFlatSteps = (
  steps: ExecutionFlowStep[]
): ExecutionFlowStep[] => {
  const flat: ExecutionFlowStep[] = [];
  const walk = (list: ExecutionFlowStep[]) => {
    for (const step of list) {
      flat.push(step);
      step.steps?.forEach((child) => walk([child]));
      step.branches?.forEach((branch) => walk(branch.steps));
      step.parallelBranches?.forEach((branch) => walk(branch));
    }
  };
  walk(steps);
  return flat;
};
