import type { HookFlowStep } from "../types";
import { hookFlowStepsToPropFlowGraphCore } from "./hookFlowStepConvert";
import { hookTraceViewToNestedPropFlowGraph } from "./hookTraceViewFlow";
import type { PropFlowGraphNode } from "./propExecutionFlow";
import { applyPropFlowTraceableFlags } from "./propExecutionFlow";

/** Client-safe: convert hook flow steps to prop-flow graph nodes (no fs/ts-morph). */
export const hookFlowStepsToPropFlowGraph = (
  steps: HookFlowStep[],
  fieldName: string
): PropFlowGraphNode[] =>
  applyPropFlowTraceableFlags(
    hookFlowStepsToPropFlowGraphCore(steps, fieldName, (step) => {
      if (step.nestedTrace && step.hookName) {
        return hookTraceViewToNestedPropFlowGraph(step.nestedTrace);
      }
      return;
    })
  );
