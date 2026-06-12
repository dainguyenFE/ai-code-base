import type { PageLogicGraph } from "../types";
import { buildHookTraceFromDataLocal } from "./hookTrace";
import {
  collectHookAutoExpandIds,
  hookTraceViewToNestedPropFlowGraph,
} from "./hookTraceViewFlow";
import type { PropFlowGraphNode } from "./propExecutionFlow";
import {
  applyPropFlowTraceableFlags,
  buildLinearPropFlowGraph,
} from "./propExecutionFlow";
import type { DataTraceChain, DataTraceStep } from "./uiGraph";

const HOOK_STEP_ROLE: Record<string, string> = {
  "consumer-assign": "assign",
  derived: "assign",
  function: "call",
  "hook-call": "call",
  return: "return",
  "state-assign": "assign",
  "state-init": "assign",
};

const resolveHookExpansionContext = (
  step: DataTraceStep,
  options: {
    consumerNodeId: string;
    variableName: string;
  }
):
  | {
      consumerNodeId: string;
      fieldName: string;
      sourceHook: string;
    }
  | undefined => {
  if (step.hookTrace?.mode === "local") {
    return {
      consumerNodeId: step.hookTrace.consumerNodeId,
      fieldName: step.hookTrace.fieldName ?? options.variableName,
      sourceHook: step.hookTrace.sourceHook,
    };
  }

  const hookName =
    step.definitionSymbol ??
    (step.label.startsWith("(hook) ")
      ? step.label.slice("(hook) ".length)
      : step.label);

  if (step.stepRole === "hook" && hookName) {
    return {
      consumerNodeId: options.consumerNodeId,
      fieldName: options.variableName,
      sourceHook: hookName,
    };
  }

  return undefined;
};

const buildHookExpandableStepsFromStep = (
  graph: PageLogicGraph,
  step: DataTraceStep,
  options: {
    consumerNodeId: string;
    rootDir: string;
    variableName: string;
  }
): PropFlowGraphNode[] => {
  const context = resolveHookExpansionContext(step, options);
  if (!context) {
    return [];
  }

  const trace = buildHookTraceFromDataLocal(
    graph,
    context.consumerNodeId,
    context.sourceHook,
    {
      fieldName: context.fieldName,
      rootDir: options.rootDir,
    }
  );

  if (!trace) {
    return [];
  }

  return applyPropFlowTraceableFlags(hookTraceViewToNestedPropFlowGraph(trace));
};

/** Linear prop-flow graph with expandable custom-hook bodies (server-side). */
export const buildEnrichedLinearPropFlowGraph = (
  graph: PageLogicGraph,
  chain: DataTraceChain,
  options: {
    consumerNodeId: string;
    fieldPath?: string;
    rootDir: string;
    variableName: string;
  }
): PropFlowGraphNode[] => {
  const base = buildLinearPropFlowGraph(graph, chain, {
    fieldPath: options.fieldPath,
  });

  return base.map((node) => {
    if (node.stepRole !== "hook") {
      return node;
    }

    const step = chain.steps.find(
      (candidate) =>
        candidate.stepRole === "hook" &&
        (candidate.label === node.label ||
          candidate.nodeId === node.nodeId ||
          candidate.definitionSymbol === node.label)
    );
    if (!step) {
      return node;
    }

    const expandableSteps = buildHookExpandableStepsFromStep(
      graph,
      step,
      options
    );
    if (expandableSteps.length === 0) {
      return node;
    }

    return {
      ...node,
      expandableSteps,
      traceable: true,
    };
  });
};
