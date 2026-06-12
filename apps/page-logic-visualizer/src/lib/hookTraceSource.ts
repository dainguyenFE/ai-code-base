import type {
  HookTraceView,
  PageLogicGraph,
  SourceLocation,
} from "@cs/page-logic-visualizer/client";

import type { PropFlowNode } from "@/lib/propFlowGraph";
import { sourceTargetFromLocation, toRepoRelativePath } from "@/lib/sourceView";
import type { TraceFocusResult } from "@/lib/sourceView";

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

const returnFieldLoc = (
  trace: HookTraceView,
  fieldName: string
): SourceLocation | undefined => {
  const returnEntry = trace.internalHooks?.find(
    (entry) => entry.kind === "return"
  );
  const child = returnEntry?.children?.find((item) => item.name === fieldName);
  if (child?.loc) {
    return child.loc;
  }

  const field = trace.returnFields.find((item) => item.name === fieldName);
  if (!field) {
    return undefined;
  }

  return (
    field.steps.find((step) => step.kind === "return" && step.loc)?.loc ??
    field.steps.find((step) => step.loc)?.loc
  );
};

const returnSectionLoc = (trace: HookTraceView): SourceLocation | undefined => {
  const returnEntry = trace.internalHooks?.find(
    (entry) => entry.kind === "return"
  );
  if (returnEntry?.loc) {
    return returnEntry.loc;
  }
  const firstField = trace.returnFields[0]?.name;
  return firstField ? returnFieldLoc(trace, firstField) : undefined;
};

const definitionTarget = (
  trace: HookTraceView,
  options?: { label?: string; searchText?: string }
): TraceFocusResult => {
  const filePath = trace.definitionFilePath;
  const symbolName = trace.definitionSymbol ?? trace.hookName;

  if (!filePath) {
    return { notice: null, target: null };
  }

  return {
    notice: null,
    target: {
      filePath: toRepoRelativePath(filePath),
      label: options?.label ?? symbolName,
      searchText: options?.searchText,
      symbolName,
    },
  };
};

const locTarget = (loc: SourceLocation, label?: string): TraceFocusResult => ({
  notice: null,
  target: sourceTargetFromLocation(loc, label),
});

const resolveReturnField = (
  trace: HookTraceView,
  fieldName: string
): TraceFocusResult => {
  const loc = returnFieldLoc(trace, fieldName);
  if (loc) {
    return locTarget(loc, fieldName);
  }

  const expression = returnFieldExpression(trace, fieldName);
  return definitionTarget(trace, {
    label: fieldName,
    searchText: expression ?? fieldName,
  });
};

const resolveLogicEntry = (
  trace: HookTraceView,
  node: PropFlowNode
): TraceFocusResult | undefined => {
  const parts = node.id.split(":");
  const logicIndex = Number.parseInt(parts[1] ?? "", 10);
  const logicEntries = (trace.internalHooks ?? []).filter(
    (entry) => entry.kind !== "return"
  );

  const entry = Number.isFinite(logicIndex)
    ? logicEntries[logicIndex]
    : logicEntries.find(
        (item) =>
          item.name === node.label ||
          (item.hookName && node.label.startsWith(item.hookName))
      );

  if (entry?.loc) {
    return locTarget(entry.loc, node.label);
  }

  if (entry?.hookName && trace.definitionFilePath) {
    return {
      notice: null,
      target: {
        filePath: toRepoRelativePath(trace.definitionFilePath),
        label: node.label,
        symbolName: entry.hookName,
      },
    };
  }

  return undefined;
};

/** Map hook trace graph nodes to source panel targets. */
export const resolveHookFlowNodeFocus = (
  _graph: PageLogicGraph,
  trace: HookTraceView,
  node: PropFlowNode
): TraceFocusResult => {
  if (node.loc) {
    return locTarget(node.loc, node.label);
  }

  const { id } = node;

  if (id === "hook:root" || id === "hook-usage:intake") {
    if (trace.callSiteLoc && id === "hook-usage:intake") {
      return locTarget(trace.callSiteLoc, node.label);
    }
    return definitionTarget(trace, { label: node.label });
  }

  if (id === "hook:section:return" || id === "hook-usage:return") {
    const sectionLoc = returnSectionLoc(trace);
    if (sectionLoc) {
      return locTarget(sectionLoc, node.label);
    }
    return definitionTarget(trace, {
      label: node.label,
      searchText: "return {",
    });
  }

  if (id.startsWith("return:") || id.startsWith("hook-usage:return:")) {
    const fieldName = id.includes("hook-usage:return:")
      ? id.slice("hook-usage:return:".length)
      : id.slice("return:".length);
    return resolveReturnField(trace, fieldName);
  }

  if (id === "hook:section:logic" || id === "logic:direct") {
    const firstLogic = (trace.internalHooks ?? []).find(
      (entry) => entry.kind !== "return"
    );
    if (firstLogic?.loc) {
      return locTarget(firstLogic.loc, node.label);
    }
    return definitionTarget(trace, { label: node.label });
  }

  if (id.startsWith("logic:")) {
    const resolved = resolveLogicEntry(trace, node);
    if (resolved) {
      return resolved;
    }
    if (node.label.startsWith("Call Hook ") || node.label.startsWith("Call ")) {
      const symbol = node.label
        .replace(/^Call Hook /, "")
        .replace(/^Call /, "");
      if (trace.definitionFilePath && symbol) {
        return {
          notice: null,
          target: {
            filePath: toRepoRelativePath(trace.definitionFilePath),
            label: node.label,
            searchText: node.detail,
            symbolName: symbol.split(/\s/)[0],
          },
        };
      }
    }
  }

  if (id === "hook:section:input") {
    const firstInput = trace.inputs[0];
    if (firstInput?.loc) {
      return locTarget(firstInput.loc, node.label);
    }
    return definitionTarget(trace, { label: node.label });
  }

  if (id.startsWith("input:")) {
    const inputName = id.slice("input:".length);
    const input = trace.inputs.find((item) => item.name === inputName);
    if (input?.loc) {
      return locTarget(input.loc, inputName);
    }
  }

  if (id.startsWith("effect:")) {
    const effectIndex = Number.parseInt(id.split(":")[1] ?? "", 10);
    const effect = Number.isFinite(effectIndex)
      ? trace.effects[effectIndex]
      : trace.effects[0];
    if (effect?.loc && id.endsWith(":hook")) {
      return locTarget(effect.loc, node.label);
    }
    if (effect && (id.endsWith(":body") || id.endsWith(":cleanup"))) {
      return definitionTarget(trace, {
        label: node.label,
        searchText: effect.cleanupExpression ?? effect.callExpression,
      });
    }
  }

  if (node.resolvedFilePath) {
    return {
      notice: null,
      target: {
        filePath: toRepoRelativePath(node.resolvedFilePath),
        label: node.label,
        searchText: node.detail,
        symbolName: node.functionName,
      },
    };
  }

  if (node.detail) {
    return definitionTarget(trace, {
      label: node.label,
      searchText: node.detail,
    });
  }

  return definitionTarget(trace, { label: node.label });
};
