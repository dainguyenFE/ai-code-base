import type {
  ExecutionFlowStep,
  HookTraceView,
  PageLogicGraph,
  ReturnFieldLiteralMeta,
} from "../types";
import { hashIdFragment } from "../utils/propFlowId";
import type { DataTraceChain, DataTraceStep } from "./uiGraph";

export interface PropExecutionFlowOptions {
  fieldPath?: string;
  returnFieldLiterals?: Record<string, ReturnFieldLiteralMeta>;
}

const KIND_TO_ROLE: Record<string, string> = {
  assign: "variable",
  "await-call": "await-call",
  branch: "branch",
  call: "call",
  "parallel-fork": "promise-all",
  "parallel-join": "join",
  resume: "resume",
  return: "return",
};

const annotateExecutionFlow = (
  steps: ExecutionFlowStep[],
  fieldPath: string | undefined,
  literals: Record<string, ReturnFieldLiteralMeta> | undefined
): void => {
  if (!fieldPath) {
    return;
  }

  const literal = literals?.[fieldPath];
  const walk = (list: ExecutionFlowStep[]) => {
    for (const step of list) {
      if (step.branches) {
        for (const branch of step.branches) {
          if (branch.branchKind === "catch" && literal && !branch.propOutcome) {
            branch.propOutcome = `${fieldPath} = ${literal.value} (catch fallback)`;
          }
          walk(branch.steps);
        }
      }
      if (step.branches) {
        for (const branch of step.branches) {
          walk(branch.steps);
        }
      }

      step.expandableSteps?.forEach((child) => walk([child]));
      step.steps?.forEach((child) => walk([child]));
    }
  };
  walk(steps);
};

export interface PropFlowGraphNode {
  id: string;
  label: string;
  detail?: string;
  narrative?: string;
  propOutcome?: string;
  stepRole?: string;
  nodeId?: string;
  loc?: ExecutionFlowStep["loc"];
  executionKind?: "await" | "sync" | "async";
  transitionLabel?: string;
  functionName?: string;
  resolvedFilePath?: string;
  expandableSteps?: PropFlowGraphNode[];
  expandLabel?: string;
  /** Function node — body graph spliced on Trace */
  traceable?: boolean;
  /** Highlight when upstream trace scopes to a related return field */
  originHighlight?: boolean;
  parallelGroup?: {
    forkDescription: string;
    joinDescription: string;
    awaitJoinId?: string;
    awaitJoinLabel?: string;
    branches: { entryTransition?: string; steps: PropFlowGraphNode[] }[];
  };
  branchGroup?: {
    label: string;
    narrative: string;
    branches: {
      branchKind: string;
      label: string;
      narrative?: string;
      description?: string;
      propOutcome?: string;
      steps: PropFlowGraphNode[];
    }[];
  };
  nestedSteps?: PropFlowGraphNode[];
  /** Hook trace context for nested hook internal graph nodes (source linking). */
  hookTrace?: HookTraceView;
}

const executionStepToGraphNode = (
  step: ExecutionFlowStep,
  previous: ExecutionFlowStep | null
): PropFlowGraphNode => {
  const node: PropFlowGraphNode = {
    detail: step.returnType ? `→ ${step.returnType}` : undefined,
    executionKind: step.awaited ? "await" : undefined,
    expandLabel: step.functionName ? `Show ${step.functionName}` : "Show",
    expandableSteps: step.expandableSteps?.map((child, index) =>
      executionStepToGraphNode(
        child,
        index > 0 ? step.expandableSteps![index - 1]! : step
      )
    ),
    functionName: step.functionName,
    id: step.id,
    label: step.label,
    loc: step.loc,
    narrative: step.narrative,
    propOutcome: step.propOutcome,
    resolvedFilePath: step.resolvedFilePath,
    stepRole: KIND_TO_ROLE[step.kind] ?? step.kind,
    transitionLabel: previous
      ? (previous.kind === "resume"
        ? "Caller continues with the returned value"
        : step.narrative)
      : undefined,
  };

  if (step.parallelBranches?.length) {
    node.parallelGroup = {
      branches: step.parallelBranches.map((branch, index) => ({
        entryTransition:
          index === 0
            ? "Starts in parallel with other calls"
            : "Runs concurrently — does not wait for siblings",
        steps: branch.map((child, childIndex) =>
          executionStepToGraphNode(
            child,
            childIndex > 0 ? branch[childIndex - 1]! : step
          )
        ),
      })),
      forkDescription: step.narrative,
      joinDescription:
        "All parallel branches settled — await continues on the next line",
    };
  }

  if (step.branches?.length) {
    node.branchGroup = {
      branches: step.branches.map((branch) => ({
        branchKind: branch.branchKind,
        description: branch.description,
        label: branch.label,
        narrative: branch.narrative,
        propOutcome: branch.propOutcome,
        steps: branch.steps.map((child, index) =>
          executionStepToGraphNode(
            child,
            index > 0 ? branch.steps[index - 1]! : step
          )
        ),
      })),
      label: step.label,
      narrative: step.narrative,
    };
  }

  if (step.steps?.length && !step.parallelBranches?.length) {
    node.nestedSteps = step.steps.map((child, index) =>
      executionStepToGraphNode(
        child,
        index > 0 ? step.steps![index - 1]! : step
      )
    );
  }

  return node;
};

const executionFlowToGraphNodes = (
  flow: ExecutionFlowStep[]
): PropFlowGraphNode[] =>
  flow.map((step, index) =>
    executionStepToGraphNode(step, index > 0 ? flow[index - 1]! : null)
  );

const memberPath = (expression: string): string | undefined => {
  const dot = expression.indexOf(".");
  return dot === -1 ? undefined : expression.slice(dot + 1);
};

const rootIdentifier = (expression: string): string =>
  expression.split(".")[0]?.trim() ?? expression;

const SHORT_EDGE_LABELS: Record<string, string> = {
  "api-call": "fetch",
  assign: "assign",
  "await-call": "call",
  "await-join": "await",
  call: "call",
  function: "call",
  hardcode: "assign",
  hook: "hook",
  literal: "assign",
  loop: "map",
  "pass-down": "pass",
  prop: "get",
  resume: "return",
  return: "return",
  variable: "get",
};

const edgeLabelForChainStep = (
  step: DataTraceStep,
  index: number,
  steps: DataTraceStep[]
): string | undefined => {
  if (index === 0) {
    return undefined;
  }
  const role = step.stepRole ?? step.type ?? "";
  if (role === "prop" && steps[index - 1]?.stepRole === "prop") {
    return "pass";
  }
  return SHORT_EDGE_LABELS[role] ?? role;
};

const markTraceableNodes = (
  nodes: PropFlowGraphNode[],
  firstTransition?: string
): PropFlowGraphNode[] =>
  nodes.map((node, index) => {
    const transitionLabel =
      index === 0 && firstTransition
        ? firstTransition
        : (index === 0
          ? "enter"
          : (SHORT_EDGE_LABELS[node.stepRole ?? ""] ??
            node.transitionLabel ??
            node.stepRole));

    return {
      ...node,
      branchGroup: node.branchGroup
        ? {
            ...node.branchGroup,
            branches: node.branchGroup.branches.map((branch) => ({
              ...branch,
              steps: markTraceableNodes(branch.steps),
            })),
          }
        : undefined,
      expandableSteps: node.expandableSteps
        ? markTraceableNodes(node.expandableSteps)
        : undefined,
      nestedSteps: node.nestedSteps
        ? markTraceableNodes(node.nestedSteps)
        : undefined,
      parallelGroup: node.parallelGroup
        ? {
            ...node.parallelGroup,
            branches: node.parallelGroup.branches.map((branch) => ({
              ...branch,
              steps: markTraceableNodes(branch.steps),
            })),
          }
        : undefined,
      traceable: Boolean(
        node.expandableSteps?.length &&
        (node.stepRole === "await-call" ||
          node.stepRole === "call" ||
          node.stepRole === "assign" ||
          node.stepRole === "return" ||
          node.stepRole === "hook")
      ),
      transitionLabel,
    };
  });

export const applyPropFlowTraceableFlags = markTraceableNodes;

export const buildFunctionBodyFlowGraph = (
  graph: PageLogicGraph,
  dataFetchNodeId: string,
  options?: PropExecutionFlowOptions
): PropFlowGraphNode[] => {
  const sourceNode = graph.nodes.find((node) => node.id === dataFetchNodeId);
  const executionFlow = sourceNode?.dataFetch?.executionFlow;
  if (!executionFlow?.length) {
    return [];
  }

  const fieldPath = options?.fieldPath;
  const annotated = structuredClone(executionFlow);
  annotateExecutionFlow(
    annotated,
    fieldPath,
    options?.returnFieldLiterals ?? sourceNode?.dataFetch?.returnFieldLiterals
  );

  return markTraceableNodes(executionFlowToGraphNodes(annotated));
};

/** Consumer → source linear prop trace; function bodies stay collapsed until Trace. */
export const buildLinearPropFlowGraph = (
  graph: PageLogicGraph,
  chain: DataTraceChain,
  options?: PropExecutionFlowOptions
): PropFlowGraphNode[] => {
  const fieldPath =
    options?.fieldPath ??
    (chain.expression.includes(".") ? memberPath(chain.expression) : undefined);

  const nodes: PropFlowGraphNode[] = [];

  for (let index = 0; index < chain.steps.length; index++) {
    const step = chain.steps[index]!;
    const role = step.stepRole ?? step.type ?? "step";

    if (role === "literal" || role === "hardcode") {
      continue;
    }

    const transitionLabel = edgeLabelForChainStep(step, index, chain.steps);

    if (role === "await-call" && step.nodeId) {
      const sourceNode = graph.nodes.find((node) => node.id === step.nodeId);
      const bodyGraph = buildFunctionBodyFlowGraph(graph, step.nodeId, {
        ...options,
        fieldPath,
      });

      nodes.push({
        executionKind: "await",
        expandableSteps: bodyGraph.length > 0 ? bodyGraph : undefined,
        functionName: sourceNode?.dataFetch?.functionName,
        id: step.nodeId,
        label: step.label,
        loc: step.loc,
        nodeId: step.nodeId,
        stepRole: "await-call",
        traceable: bodyGraph.length > 0,
        transitionLabel: transitionLabel ?? "call",
      });
      continue;
    }

    nodes.push({
      detail: step.detail,
      executionKind: step.executionKind,
      id: `${step.nodeId ?? `step:${hashIdFragment(step.label)}`}:${role}:${index}`,
      label: step.label,
      loc: step.loc,
      nodeId: step.nodeId,
      resolvedFilePath: step.sourceFilePath,
      stepRole: role === "hardcode" ? "literal" : role,
      transitionLabel,
    });
  }

  return markTraceableNodes(nodes);
};

export const buildPropExecutionFlowGraph = (
  graph: PageLogicGraph,
  chain: DataTraceChain,
  options?: PropExecutionFlowOptions
): PropFlowGraphNode[] => {
  const fieldPath =
    options?.fieldPath ??
    (chain.expression.includes(".") ? memberPath(chain.expression) : undefined);

  const awaitStep = chain.steps.find(
    (step) => step.stepRole === "await-call" && step.nodeId
  );
  const sourceNode = awaitStep
    ? graph.nodes.find((node) => node.id === awaitStep.nodeId)
    : undefined;
  const executionFlow = sourceNode?.dataFetch?.executionFlow;

  const nodes: PropFlowGraphNode[] = [];

  if (executionFlow?.length) {
    const annotated = structuredClone(executionFlow);
    annotateExecutionFlow(
      annotated,
      fieldPath,
      options?.returnFieldLiterals ?? sourceNode?.dataFetch?.returnFieldLiterals
    );

    const bodyGraph = executionFlowToGraphNodes(annotated);

    if (awaitStep) {
      nodes.push({
        executionKind: "await",
        id: `${awaitStep.nodeId}:entry`,
        label: awaitStep.label,
        loc: awaitStep.loc,
        narrative:
          "Page awaits this async function — nothing below renders until it resolves",
        nestedSteps: bodyGraph,
        nodeId: awaitStep.nodeId,
        stepRole: "await-call",
      });
      nodes.push({
        id: `${awaitStep.nodeId}:page-resume`,
        label: "← data ready on page",
        narrative: `Resolved object is bound — ${fieldPath ?? "prop"} is read from this value`,
        stepRole: "resume",
      });
    } else {
      nodes.push(...bodyGraph);
    }
  }

  const traceTail = chain.steps.filter(
    (step) =>
      step.stepRole !== "await-call" ||
      !executionFlow?.length ||
      step.nodeId !== awaitStep?.nodeId
  );

  for (const step of traceTail) {
    if (step.stepRole === "variable" && executionFlow?.length) {
      continue;
    }
    nodes.push(traceStepToGraphNode(step));
  }

  return nodes;
};

const traceStepToGraphNode = (step: DataTraceStep): PropFlowGraphNode => ({
  detail: step.detail,
  executionKind: step.executionKind,
  id: step.nodeId,
  label: step.label,
  loc: step.loc,
  nodeId: step.nodeId,
  stepRole: step.stepRole ?? step.type,
});

export const mergeExecutionFlowWithDownstream = (
  upstream: PropFlowGraphNode[],
  downstream: PropFlowGraphNode[]
): PropFlowGraphNode[] => {
  const merged = [...upstream];
  for (const node of downstream) {
    merged.push({
      ...node,
      transitionLabel:
        node.stepRole === "prop"
          ? "Resolved value arrives as JSX prop"
          : (node.stepRole === "pass-down"
            ? "Prop forwarded to child component"
            : "Next step in the render/data path"),
    });
  }
  return merged;
};

export const findPropFlowGraphNodeById = (
  nodes: PropFlowGraphNode[],
  id: string
): PropFlowGraphNode | undefined => {
  for (const node of nodes) {
    if (node.id === id || node.nodeId === id) {
      return node;
    }
    if (node.expandableSteps) {
      const found = findPropFlowGraphNodeById(node.expandableSteps, id);
      if (found) {
        return found;
      }
    }
    if (node.nestedSteps) {
      const found = findPropFlowGraphNodeById(node.nestedSteps, id);
      if (found) {
        return found;
      }
    }
    if (node.parallelGroup) {
      for (const branch of node.parallelGroup.branches) {
        const found = findPropFlowGraphNodeById(branch.steps, id);
        if (found) {
          return found;
        }
      }
    }
    if (node.branchGroup) {
      for (const branch of node.branchGroup.branches) {
        const found = findPropFlowGraphNodeById(branch.steps, id);
        if (found) {
          return found;
        }
      }
    }
  }
  return undefined;
};
