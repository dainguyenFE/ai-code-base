import type { HookFlowStep } from "../types";
import { propFlowSafeStepId } from "../utils/propFlowId";
import type { PropFlowGraphNode } from "./propExecutionFlow";

const HOOK_STEP_ROLE: Record<string, string> = {
  "consumer-assign": "assign",
  derived: "assign",
  function: "call",
  "hook-call": "call",
  return: "return",
  "state-assign": "assign",
  "state-init": "assign",
};

type ExpandableResolver = (
  step: HookFlowStep,
  fieldName: string
) => PropFlowGraphNode[] | undefined;

/** Core step → prop-flow conversion (expandable steps resolved via callback). */
export const hookFlowStepsToPropFlowGraphCore = (
  steps: HookFlowStep[],
  fieldName: string,
  resolveExpandable?: ExpandableResolver
): PropFlowGraphNode[] =>
  steps.map((step, index) => {
    const previous = index > 0 ? steps[index - 1]! : null;
    let expandableSteps: PropFlowGraphNode[] | undefined;

    if (step.paramTraceSteps?.length) {
      expandableSteps = hookFlowStepsToPropFlowGraphCore(
        step.paramTraceSteps,
        fieldName,
        resolveExpandable
      );
    } else if (resolveExpandable) {
      expandableSteps = resolveExpandable(step, fieldName);
    }

    if (!expandableSteps && step.children?.length) {
      expandableSteps = hookFlowStepsToPropFlowGraphCore(
        step.children,
        fieldName,
        resolveExpandable
      );
    }

    return {
      detail: step.expression,
      executionKind: step.kind === "hook-call" ? "sync" : undefined,
      expandableSteps,
      functionName: step.hookName ?? step.nestedHookName,
      id: propFlowSafeStepId(`hook:${step.kind}`, index, {
        key: step.label,
        line: step.loc?.startLine,
      }),
      label: step.label,
      loc: step.loc,
      stepRole: step.isBuiltIn
        ? "hook"
        : (HOOK_STEP_ROLE[step.kind] ?? step.kind),
      traceable: Boolean(expandableSteps?.length),
      transitionLabel: previous?.label,
    };
  });
