import type {
  HookFlowStep,
  HookInputTrace,
  HookInternalEntry,
  HookReturnFieldTrace,
  HookTraceView,
} from "../types";
import { isCustomHookName } from "../utils/reactHooks";
import { hookFlowStepsToPropFlowGraphCore } from "./hookFlowStepConvert";
import type { PropFlowGraphNode } from "./propExecutionFlow";

const returnFieldExpression = (
  trace: HookTraceView,
  fieldName: string
): string | undefined => {
  const returnEntry = trace.internalHooks?.find(
    (entry) => entry.kind === "return"
  );
  const child = returnEntry?.children?.find((item) => item.name === fieldName);
  if (child?.expression) {
    return child.expression;
  }
  const field = trace.returnFields.find((item) => item.name === fieldName);
  return field?.steps.at(-1)?.expression ?? field?.steps[0]?.expression;
};

/** Property/method reference vs call — setters/refs vs computed values. */
export const isFunctionReturnExpression = (expression: string): boolean => {
  const trimmed = expression.trim();
  if (!trimmed) {
    return false;
  }
  if (/\([^)]*\)\s*$/.test(trimmed)) {
    return false;
  }
  if (/[=]>\s*\{/.test(trimmed) || /\bfunction\s*\(/.test(trimmed)) {
    return true;
  }
  if (/^[a-zA-Z_$][\w$.[\]'"]*$/.test(trimmed)) {
    return true;
  }
  return false;
};

const isFunctionReturnField = (
  trace: HookTraceView,
  field: HookReturnFieldTrace
): boolean => {
  if (/^set[A-Z]/.test(field.name)) {
    return true;
  }
  if (field.steps.some((step) => step.kind === "function")) {
    return true;
  }
  const expression = returnFieldExpression(trace, field.name);
  return expression ? isFunctionReturnExpression(expression) : false;
};

const logicEntryRelatesToOrigin = (
  entry: HookInternalEntry,
  originField: string
): boolean =>
  entry.name === originField ||
  Boolean(entry.expression?.includes(originField)) ||
  Boolean(entry.dependencies?.includes(originField));

const inputRelatesToOrigin = (
  input: HookInputTrace,
  originField: string
): boolean => {
  if (input.name === originField || input.expression.includes(originField)) {
    return true;
  }
  return Boolean(
    input.traceSteps?.some(
      (step) =>
        step.label.includes(originField) ||
        step.expression.includes(originField)
    )
  );
};

const applyOriginHighlight = (
  nodes: PropFlowGraphNode[],
  originField: string | undefined
): PropFlowGraphNode[] => {
  if (!originField) {
    return nodes;
  }

  const visit = (node: PropFlowGraphNode): PropFlowGraphNode => ({
    ...node,
    branchGroup: node.branchGroup
      ? {
          ...node.branchGroup,
          branches: node.branchGroup.branches.map((branch) => ({
            ...branch,
            steps: branch.steps.map(visit),
          })),
        }
      : undefined,
    expandableSteps: node.expandableSteps?.map(visit),
    nestedSteps: node.nestedSteps?.map(visit),
    originHighlight:
      node.originHighlight ||
      node.id === `return:${originField}` ||
      node.label === originField,
  });

  return nodes.map(visit);
};

const expandHookFlowSteps = (
  steps: HookFlowStep[],
  fieldName: string
): PropFlowGraphNode[] =>
  hookFlowStepsToPropFlowGraphCore(steps, fieldName, (step) => {
    if (step.nestedTrace && step.hookName) {
      return hookTraceViewToPropFlowGraph(step.nestedTrace);
    }
    return;
  });

const inputToFlowNode = (
  input: HookInputTrace,
  originField: string | undefined
): PropFlowGraphNode => {
  const expandableSteps = input.traceSteps?.length
    ? hookFlowStepsToPropFlowGraphCore(input.traceSteps, input.name)
    : undefined;

  return {
    detail: input.expression,
    expandableSteps,
    id: `input:${input.name}`,
    label: input.name,
    loc: input.loc,
    narrative: `Parameter: ${input.kind}`,
    originHighlight: originField
      ? inputRelatesToOrigin(input, originField)
      : undefined,
    stepRole: "prop",
    traceable: Boolean(expandableSteps?.length),
  };
};

const internalEntryToLogicNode = (
  entry: HookInternalEntry,
  index: number,
  originField: string | undefined
): PropFlowGraphNode => {
  const childSteps = entry.children?.map((child, childIndex) =>
    internalEntryToLogicNode(
      { ...child, kind: child.kind === "return" ? "variable" : child.kind },
      childIndex,
      originField
    )
  );

  const isHookCall = entry.kind === "hook" || entry.kind === "builtin";

  return {
    detail: entry.expression ?? entry.name,
    expandableSteps: childSteps?.length ? childSteps : undefined,
    functionName: entry.hookName,
    id: `logic:${index}:${entry.name}`,
    label: entry.hookName ? `${entry.hookName}()` : entry.name,
    loc: entry.loc,
    originHighlight: originField
      ? logicEntryRelatesToOrigin(entry, originField)
      : undefined,
    stepRole: isHookCall
      ? "hook"
      : (entry.kind === "variable"
        ? "derive"
        : "call"),
    traceable: Boolean(childSteps?.length),
  };
};

const buildLogicSteps = (
  trace: HookTraceView,
  originField: string | undefined
): PropFlowGraphNode[] => {
  const logicEntries = (trace.internalHooks ?? []).filter(
    (entry) => entry.kind !== "return"
  );

  if (logicEntries.length === 0) {
    return [
      {
        detail:
          "No statements before return — hook exposes return value directly",
        id: "logic:direct",
        label: "Direct return",
        stepRole: "join",
      },
    ];
  }

  return logicEntries.map((entry, index) =>
    internalEntryToLogicNode(entry, index, originField)
  );
};

const isScopedHookTrace = (trace: HookTraceView): boolean =>
  trace.traceScope === "return-field" || Boolean(trace.focusedReturnField);

const returnFieldLoc = (
  trace: HookTraceView,
  fieldName: string
): HookInternalEntry["loc"] => {
  const returnEntry = trace.internalHooks?.find(
    (entry) => entry.kind === "return"
  );
  const child = returnEntry?.children?.find((item) => item.name === fieldName);
  if (child?.loc) {
    return child.loc;
  }
  const field = trace.returnFields.find((item) => item.name === fieldName);
  return (
    field?.steps.find((step) => step.kind === "return" && step.loc)?.loc ??
    field?.steps.find((step) => step.loc)?.loc
  );
};

const returnFieldToFlowNode = (
  trace: HookTraceView,
  field: HookReturnFieldTrace,
  originField: string | undefined,
  scoped: boolean
): PropFlowGraphNode => {
  const expression = returnFieldExpression(trace, field.name);
  const isOrigin = originField === field.name;
  const canExpandFieldSteps = scoped && field.steps.length > 0;
  const loc = returnFieldLoc(trace, field.name);
  const resolvedFilePath =
    loc?.filePath ?? trace.definitionFilePath ?? undefined;

  if (!canExpandFieldSteps) {
    return {
      detail: expression ?? `return.${field.name}`,
      id: `return:${field.name}`,
      label: field.name,
      loc,
      originHighlight: isOrigin,
      resolvedFilePath,
      stepRole: "return",
    };
  }

  return {
    detail: expression ?? field.steps.at(-1)?.expression,
    expandableSteps: expandHookFlowSteps(field.steps, field.name),
    id: `return:${field.name}`,
    label: field.name,
    loc,
    originHighlight: isOrigin,
    resolvedFilePath,
    stepRole: "return",
    traceable: true,
  };
};

const buildReturnSection = (
  trace: HookTraceView,
  originField: string | undefined
): PropFlowGraphNode => {
  if (trace.returnFields.length === 0) {
    return {
      detail: "void",
      id: "hook:section:return",
      label: "Return",
      narrative: "What this hook returns to the caller",
      resolvedFilePath: trace.definitionFilePath,
      stepRole: "return",
    };
  }

  const valueFields: PropFlowGraphNode[] = [];
  const functionFields: PropFlowGraphNode[] = [];

  for (const field of trace.returnFields) {
    const node = returnFieldToFlowNode(
      trace,
      field,
      originField,
      isScopedHookTrace(trace)
    );
    if (isFunctionReturnField(trace, field)) {
      functionFields.push(node);
    } else {
      valueFields.push(node);
    }
  }

  const branches = [
    ...(valueFields.length > 0
      ? [
          {
            branchKind: "value",
            description: "Read by the caller (state, data, computed values)",
            label: "Values",
            steps: valueFields,
          },
        ]
      : []),
    ...(functionFields.length > 0
      ? [
          {
            branchKind: "function",
            description:
              "Setters, actions, and callbacks returned to the caller",
            label: "Functions",
            steps: functionFields,
          },
        ]
      : []),
  ];

  return {
    branchGroup:
      branches.length > 0
        ? {
            branches,
            label: "Return object",
            narrative: "Values and functions exposed to the consumer",
          }
        : undefined,
    detail:
      trace.returnFields.length > 0
        ? `{ ${trace.returnFields.map((field) => field.name).join(", ")} }`
        : "void",
    id: "hook:section:return",
    label: "Return",
    narrative: "What this hook returns to the caller",
    originHighlight: Boolean(
      originField &&
      trace.returnFields.some((field) => field.name === originField)
    ),
    stepRole: "return",
    traceable: trace.returnFields.length > 0,
  };
};

/** Attach hook trace context to every node in a hook internal flow graph. */
export const attachHookTraceToFlowGraph = (
  nodes: PropFlowGraphNode[],
  trace: HookTraceView
): PropFlowGraphNode[] => {
  const visit = (node: PropFlowGraphNode): PropFlowGraphNode => ({
    ...node,
    branchGroup: node.branchGroup
      ? {
          ...node.branchGroup,
          branches: node.branchGroup.branches.map((branch) => ({
            ...branch,
            steps: branch.steps.map(visit),
          })),
        }
      : undefined,
    expandableSteps: node.expandableSteps?.map(visit),
    hookTrace: trace,
    nestedSteps: node.nestedSteps?.map(visit),
  });

  return nodes.map(visit);
};

/** Auto-expand section ids when upstream trace scopes to a return field. */
export const collectHookAutoExpandIds = (trace: HookTraceView): string[] => {
  const origin = trace.focusedReturnField;
  const scoped = isScopedHookTrace(trace);

  if (!scoped) {
    return ["hook:section:return"];
  }

  if (!origin) {
    return ["hook:section:logic", "hook:section:return"];
  }

  const ids = new Set<string>([
    "hook:section:logic",
    "hook:section:return",
    `return:${origin}`,
  ]);

  if (trace.inputs.some((input) => inputRelatesToOrigin(input, origin))) {
    ids.add("hook:section:input");
  }

  const logicEntries = (trace.internalHooks ?? []).filter(
    (entry) => entry.kind !== "return"
  );
  for (const [index, entry] of logicEntries.entries()) {
    if (logicEntryRelatesToOrigin(entry, origin) && entry.nestedTrace) {
      ids.add(`logic:${index}:${entry.name}`);
    }
  }

  return [...ids];
};

/**
 * Hook internal trace: Input → Logic → Return (values / functions split).
 * Client-safe — used by the visualizer and nested hook expansion in prop flows.
 */
export const hookTraceViewToPropFlowGraph = (
  trace: HookTraceView
): PropFlowGraphNode[] => {
  const originField = trace.focusedReturnField;

  const nodes: PropFlowGraphNode[] = [
    {
      detail: trace.callExpression,
      id: "hook:root",
      label: `${trace.hookName}()`,
      loc: trace.callSiteLoc,
      stepRole: "hook",
    },
  ];

  if (trace.inputs.length > 0) {
    const inputSteps = trace.inputs.map((input) =>
      inputToFlowNode(input, originField)
    );
    nodes.push({
      detail: `${trace.inputs.length} parameter(s)`,
      expandableSteps: inputSteps,
      id: "hook:section:input",
      label: "Input",
      narrative: "Parameters passed into this hook",
      originHighlight: originField
        ? inputSteps.some((step) => step.originHighlight)
        : undefined,
      stepRole: "prop",
      traceable: true,
    });
  }

  const logicSteps = buildLogicSteps(trace, originField);
  nodes.push({
    detail: `${logicSteps.length} step(s) in hook body`,
    expandableSteps: logicSteps,
    id: "hook:section:logic",
    label: "Logic",
    narrative: "Calls, computations, and nested hooks inside the hook body",
    originHighlight: originField
      ? logicSteps.some((step) => step.originHighlight)
      : undefined,
    stepRole: "call",
    traceable: true,
  });

  if (trace.returnFields.length > 0) {
    nodes.push(buildReturnSection(trace, originField));
  }

  return applyOriginHighlight(nodes, originField);
};

/** Nested under a hook node in variable upstream trace (no duplicate hook root). */
export const hookTraceViewToNestedPropFlowGraph = (
  trace: HookTraceView
): PropFlowGraphNode[] => {
  const nodes = hookTraceViewToPropFlowGraph(trace);
  return nodes[0]?.id === "hook:root" ? nodes.slice(1) : nodes;
};
