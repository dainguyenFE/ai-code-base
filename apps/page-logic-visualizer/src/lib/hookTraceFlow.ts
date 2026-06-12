import type {
  EffectHookTrace,
  HookTraceGraph,
  HookTraceGraphNode,
  HookTraceView,
  HookUsage,
} from "@cs/page-logic-visualizer/client";
import {
  collectHookAutoExpandIds,
  hookTraceViewToPropFlowGraph,
} from "@cs/page-logic-visualizer/client";

import type { PropFlowNode } from "@/lib/propFlowGraph";
import type { UsageFlowBranch, UsageFlowGraph } from "@/lib/propUsageFlow";

export {
  collectHookAutoExpandIds,
  isFunctionReturnExpression,
} from "@cs/page-logic-visualizer/client";

const HOOK_NODE_ROLE: Record<string, string> = {
  "builtin-hook": "hook",
  condition: "branch",
  "custom-hook": "hook",
  effect: "hook",
  "function-call": "call",
  "hook-call": "hook",
  "jsx-prop": "prop",
  property: "assign",
  query: "api-call",
  "return-field": "return",
  "state-setter": "assign",
  transform: "derive",
  unknown: "variable",
  variable: "variable",
};

const usageKindRole: Record<string, string> = {
  callback: "call",
  condition: "branch",
  "function-call": "call",
  "hook-arg": "hook",
  "jsx-prop": "prop",
  "jsx-render": "prop",
};

/** Hook internal graph: Input → Logic → Return. */
export const hookInternalToFlowNodes = (trace: HookTraceView): PropFlowNode[] =>
  hookTraceViewToPropFlowGraph(trace);

const propFlowFromGraphNode = (node: HookTraceGraphNode): PropFlowNode => ({
  detail: node.code,
  id: `hook-graph:${node.id}`,
  label: node.label,
  loc: node.file
    ? {
        endColumn: 0,
        endLine: node.line ?? 0,
        filePath: node.file,
        startColumn: 0,
        startLine: node.line ?? 0,
      }
    : undefined,
  resolvedFilePath: node.file,
  stepRole: HOOK_NODE_ROLE[node.kind] ?? node.kind,
});

/** Raw DAG from HookTraceGraph analysis (legacy / debug). */
export const hookTraceGraphToFlowNodes = (
  graph: HookTraceGraph | undefined
): PropFlowNode[] => {
  if (!graph || graph.nodes.length === 0) {
    return [];
  }

  const incoming = new Map<string, number>();
  for (const node of graph.nodes) {
    incoming.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  const roots = graph.nodes.filter(
    (node) =>
      node.kind === "custom-hook" ||
      node.kind === "hook-call" ||
      (incoming.get(node.id) ?? 0) === 0
  );
  const root = roots[0] ?? graph.nodes[0]!;

  const visited = new Set<string>();
  const ordered: HookTraceGraphNode[] = [];

  const walk = (nodeId: string) => {
    if (visited.has(nodeId)) {
      return;
    }
    visited.add(nodeId);
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return;
    }
    ordered.push(node);
    for (const edge of graph.edges) {
      if (edge.from === nodeId) {
        walk(edge.to);
      }
    }
  };

  walk(root.id);
  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      ordered.push(node);
    }
  }

  return ordered.map((node, index) => {
    const outEdges = graph.edges.filter((edge) => edge.from === node.id);
    const nestedFromEdges = outEdges
      .map((edge) => graph.nodes.find((item) => item.id === edge.to))
      .filter((item): item is HookTraceGraphNode => Boolean(item))
      .map(propFlowFromGraphNode);

    const base = propFlowFromGraphNode(node);
    return {
      ...base,
      expandableSteps: nestedFromEdges.length > 1 ? nestedFromEdges : undefined,
      traceable: nestedFromEdges.length > 1,
      transitionLabel:
        index > 0
          ? graph.edges.find(
              (edge) =>
                edge.to === node.id &&
                graph.nodes.some((item) => item.id === edge.from)
            )?.label
          : undefined,
    };
  });
};

const usageMatchesField = (
  usage: HookUsage,
  fieldName: string,
  binding?: string
): boolean => {
  const haystack = `${usage.label} ${usage.code ?? ""}`.toLowerCase();
  if (haystack.includes(fieldName.toLowerCase())) {
    return true;
  }
  if (binding && haystack.includes(`${binding}.${fieldName}`.toLowerCase())) {
    return true;
  }
  return false;
};

const usageToBranch = (usage: HookUsage, index: number): UsageFlowBranch => ({
  edgeLabel: usage.kind,
  node: {
    detail: usage.code,
    id: `usage:${index}:${usage.label}`,
    label: usage.label,
    loc: usage.file
      ? {
          endColumn: 0,
          endLine: usage.line ?? 0,
          filePath: usage.file,
          startColumn: 0,
          startLine: usage.line ?? 0,
        }
      : undefined,
    stepRole: usageKindRole[usage.kind] ?? usage.kind,
  },
});

/** Hook → return fields → consumer usages. */
export const buildHookUsageFlowGraph = (
  trace: HookTraceView
): UsageFlowGraph | null => {
  const usages = trace.usages ?? [];
  const { returnFields } = trace;
  const binding = trace.bindingVariable ?? trace.target?.name;

  if (returnFields.length === 0 && usages.length === 0) {
    return null;
  }

  const intake: PropFlowNode = {
    detail: trace.callExpression,
    id: "hook-usage:intake",
    label: trace.bindingVariable
      ? `${trace.bindingVariable} ← ${trace.hookName}()`
      : `${trace.hookName}()`,
    loc: trace.callSiteLoc,
    stepRole: "hook",
  };

  if (returnFields.length === 0) {
    return {
      branches: usages.map((usage, index) => usageToBranch(usage, index)),
      intake,
    };
  }

  const branches: UsageFlowBranch[] = returnFields.flatMap((field) => {
    const fieldLoc =
      field.steps.find((step) => step.kind === "return" && step.loc)?.loc ??
      field.steps.find((step) => step.loc)?.loc;

    const fieldNode: PropFlowNode = {
      detail: `return.${field.name}`,
      id: `hook-usage:return:${field.name}`,
      label: field.name,
      loc: fieldLoc,
      originHighlight: trace.focusedReturnField === field.name,
      resolvedFilePath:
        fieldLoc?.filePath ?? trace.definitionFilePath ?? undefined,
      stepRole: "return",
    };

    const fieldUsages = usages.filter((usage) =>
      usageMatchesField(usage, field.name, binding)
    );

    if (fieldUsages.length === 0) {
      return [
        {
          edgeLabel: "returns",
          node: fieldNode,
        },
      ];
    }

    return fieldUsages.map((usage, index) => ({
      children: [usageToBranch(usage, index)],
      edgeLabel: "returns",
      node: fieldNode,
    }));
  });

  return { branches, intake };
};

const effectWarningToNode = (
  effect: EffectHookTrace,
  warning: EffectHookTrace["warnings"][number],
  index: number
): PropFlowNode => ({
  detail: warning.expression,
  id: `effect:${effect.hookName}:warn:${index}`,
  label: warning.kind,
  loc: warning.loc,
  narrative: warning.message,
  stepRole: warning.kind === "set-state" ? "assign" : "call",
});

/** Render cycle → effect → deps → body actions → cleanup. */
export const buildEffectFlowNodes = (trace: HookTraceView): PropFlowNode[] => {
  if (trace.effects.length === 0) {
    return [];
  }

  const nodes: PropFlowNode[] = [
    {
      detail: "React commits DOM updates, then runs effects",
      id: "effect:render",
      label: "After render",
      stepRole: "resume",
    },
  ];

  for (const [effectIndex, effect] of trace.effects.entries()) {
    nodes.push({
      detail: effect.callExpression,
      id: `effect:${effectIndex}:hook`,
      label: `${effect.hookName}()`,
      loc: effect.loc,
      stepRole: "hook",
    });

    nodes.push({
      detail:
        effect.dependencies.length > 0
          ? `[${effect.dependencies.join(", ")}]`
          : "[] (mount only)",
      id: `effect:${effectIndex}:deps`,
      label: "dependencies",
      stepRole: "variable",
    });

    if (effect.warnings.length > 0) {
      for (const [index, warning] of effect.warnings.entries()) {
        nodes.push(effectWarningToNode(effect, warning, index));
      }
    } else {
      nodes.push({
        detail: "Effect callback body",
        id: `effect:${effectIndex}:body`,
        label: "run effect",
        stepRole: "call",
      });
    }

    if (effect.hasCleanup) {
      nodes.push({
        detail: effect.cleanupExpression ?? "cleanup function",
        id: `effect:${effectIndex}:cleanup`,
        label: "cleanup",
        narrative: "Runs before re-run and on unmount",
        stepRole: "return",
      });
    } else {
      nodes.push({
        detail: "No cleanup returned",
        id: `effect:${effectIndex}:no-cleanup`,
        label: "no cleanup",
        stepRole: "join",
      });
    }
  }

  return nodes;
};

export type HookTraceGraphView = "internal" | "usage" | "effect";

export const defaultHookTraceGraphView = (
  trace: HookTraceView
): HookTraceGraphView => {
  if (trace.effects.length > 0 && trace.returnFields.length === 0) {
    return "effect";
  }
  if ((trace.usages?.length ?? 0) > 0 && trace.returnFields.length > 0) {
    return "usage";
  }
  return "internal";
};
