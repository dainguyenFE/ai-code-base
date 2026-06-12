import type {
  HookInternalEntry,
  HookTraceGraph,
  HookTraceGraphEdge,
  HookTraceGraphNode,
  ReturnLineage,
  TraceWarning,
} from "../../types";
import { isCustomHookName, isReactBuiltInHook } from "../../utils/reactHooks";
import type {
  BodyReturnField,
  BodyVariableBinding,
  HookAssignmentBinding,
  HookBodyAnalysis,
} from "./shared";
import { resolveSourceVariable, rootIdentifier } from "./shared";

let nodeCounter = 0;

const nextId = (prefix: string): string => {
  nodeCounter += 1;
  return `${prefix}:${nodeCounter}`;
};

const resetIds = (): void => {
  nodeCounter = 0;
};

const nodeKindForVariable = (
  variable: BodyVariableBinding
): HookTraceGraphNode["kind"] => {
  if (variable.kind === "hook") {
    return "custom-hook";
  }
  if (
    variable.kind === "builtin" ||
    variable.kind === "memo" ||
    variable.kind === "callback" ||
    variable.kind === "state" ||
    variable.kind === "ref" ||
    variable.kind === "effect"
  ) {
    return "builtin-hook";
  }
  if (variable.kind === "memo" || variable.kind === "callback") {
    return "transform";
  }
  return "variable";
};

export const buildInternalHookTree = ({
  bodyAnalysis,
  hookName,
}: {
  bodyAnalysis: HookBodyAnalysis;
  hookName: string;
}): HookInternalEntry[] => {
  const entries: HookInternalEntry[] = [];

  for (const variable of bodyAnalysis.variables) {
    if (variable.kind === "effect") {
      entries.push({
        dependencies: variable.dependencies,
        expression: variable.expression,
        hookName: variable.hookName,
        kind: "hook",
        loc: variable.loc,
        name: variable.hookName ?? variable.name,
      });
      continue;
    }

    entries.push({
      dependencies: variable.dependencies,
      expression: variable.expression,
      hookName: variable.hookName,
      kind:
        variable.kind === "hook"
          ? "hook"
          : (variable.hookName && isReactBuiltInHook(variable.hookName)
            ? "builtin"
            : "variable"),
      loc: variable.loc,
      name: variable.name,
    });
  }

  if (bodyAnalysis.returnFields.length > 0) {
    entries.push({
      children: bodyAnalysis.returnFields.map((field) => ({
        expression: field.expression,
        kind: "return" as const,
        loc: field.loc,
        name: field.name,
      })),
      kind: "return",
      name: `return { ${bodyAnalysis.returnFields.map((field) => field.name).join(", ")} }`,
    });
  }

  return entries;
};

export const buildHookTraceGraphData = ({
  assignment,
  bodyAnalysis,
  bindingVariable,
  hookDefinitionFile,
  hookName,
  warnings,
}: {
  assignment: HookAssignmentBinding;
  bodyAnalysis: HookBodyAnalysis;
  bindingVariable: string;
  hookDefinitionFile: string;
  hookName: string;
  warnings: TraceWarning[];
}): {
  graph: HookTraceGraph;
  hookNode: HookTraceGraphNode;
  internalHooks: HookInternalEntry[];
  returnLineage: ReturnLineage[];
  warnings: TraceWarning[];
} => {
  resetIds();

  const nodes: HookTraceGraphNode[] = [];
  const edges: HookTraceGraphEdge[] = [];
  const varNodeByName = new Map<string, string>();

  const hookNode: HookTraceGraphNode = {
    code: assignment.callExpression,
    file: hookDefinitionFile,
    id: nextId("hook"),
    kind: isCustomHookName(hookName) ? "custom-hook" : "hook-call",
    label: hookName,
    line: assignment.loc?.startLine,
  };
  nodes.push(hookNode);

  const callerNodeId = nextId("caller");
  nodes.push({
    code: assignment.callExpression,
    file: assignment.loc?.filePath,
    id: callerNodeId,
    kind: "variable",
    label: bindingVariable,
    line: assignment.loc?.startLine,
  });
  edges.push({
    from: callerNodeId,
    id: nextId("edge"),
    kind: "calls",
    label: "assign",
    to: hookNode.id,
  });

  for (const variable of bodyAnalysis.variables) {
    const varNodeId = nextId("var");
    varNodeByName.set(variable.name, varNodeId);
    nodes.push({
      code: variable.expression,
      file: hookDefinitionFile,
      id: varNodeId,
      kind: nodeKindForVariable(variable),
      label: variable.hookName ?? variable.name,
      line: variable.loc?.startLine,
      meta: {
        dependencies: variable.dependencies,
        transformBody: variable.transformBody,
        variableKind: variable.kind,
      },
    });
    edges.push({
      from: hookNode.id,
      id: nextId("edge"),
      kind: "declares",
      to: varNodeId,
    });

    if (variable.hookName) {
      const calleeId = nextId("callee");
      nodes.push({
        code: variable.expression,
        file: hookDefinitionFile,
        id: calleeId,
        kind: isCustomHookName(variable.hookName)
          ? "custom-hook"
          : "builtin-hook",
        label: `${variable.hookName}()`,
        line: variable.loc?.startLine,
      });
      edges.push({
        from: varNodeId,
        id: nextId("edge"),
        kind: "calls",
        to: calleeId,
      });
    }

    for (const dep of variable.dependencies) {
      const depRoot = rootIdentifier(dep);
      const depNodeId = varNodeByName.get(depRoot);
      if (depNodeId) {
        edges.push({
          from: depNodeId,
          id: nextId("edge"),
          kind: "depends-on",
          label: dep,
          to: varNodeId,
        });
      }
    }

    if (variable.argumentExpression) {
      const argRoot = rootIdentifier(variable.argumentExpression);
      const argNodeId = varNodeByName.get(argRoot);
      if (argNodeId) {
        edges.push({
          from: argNodeId,
          id: nextId("edge"),
          kind: "passed-to",
          label: variable.argumentExpression,
          to: varNodeId,
        });
      }
    }
  }

  const returnLineage: ReturnLineage[] = [];

  for (const field of bodyAnalysis.returnFields) {
    const returnNodeId = nextId("return");
    nodes.push({
      code: field.expression,
      file: hookDefinitionFile,
      id: returnNodeId,
      kind: "return-field",
      label: field.name,
      line: field.loc?.startLine,
    });
    edges.push({
      from: hookNode.id,
      id: nextId("edge"),
      kind: "returns-as",
      label: field.name,
      to: returnNodeId,
    });

    const sourceVar = resolveSourceVariable(
      field.expression,
      bodyAnalysis.variables
    );
    const sourceNodeId = sourceVar
      ? varNodeByName.get(sourceVar.name)
      : undefined;
    const dependencyNodeIds: string[] = [];

    if (sourceNodeId) {
      edges.push({
        from: sourceNodeId,
        id: nextId("edge"),
        kind: "returns-as",
        label: field.expression,
        to: returnNodeId,
      });
      dependencyNodeIds.push(sourceNodeId);

      for (const dep of sourceVar?.dependencies ?? []) {
        const depRoot = rootIdentifier(dep);
        const depNodeId = varNodeByName.get(depRoot);
        if (depNodeId) {
          dependencyNodeIds.push(depNodeId);
        }
      }
    }

    const callerFieldNodeId = nextId("caller-field");
    nodes.push({
      code: `${bindingVariable}.${field.name}`,
      file: assignment.loc?.filePath,
      id: callerFieldNodeId,
      kind: "property",
      label: `${bindingVariable}.${field.name}`,
      line: assignment.loc?.startLine,
    });
    edges.push({
      from: returnNodeId,
      id: nextId("edge"),
      kind: "returns-as",
      label: field.name,
      to: callerFieldNodeId,
    });

    returnLineage.push({
      callerAccessPath: `${bindingVariable}.${field.name}`,
      dependencyNodeIds: [...new Set(dependencyNodeIds)],
      returnedName: field.name,
      sourceNodeId: sourceNodeId ?? returnNodeId,
    });
  }

  const internalHooks = buildInternalHookTree({ bodyAnalysis, hookName });

  return {
    graph: { edges, nodes },
    hookNode,
    internalHooks,
    returnLineage,
    warnings,
  };
};

export const lineageToFlowSteps = ({
  bindingVariable,
  bodyAnalysis,
  focusedField,
}: {
  bindingVariable?: string;
  bodyAnalysis: HookBodyAnalysis;
  focusedField?: string;
}): Map<string, import("../../types").HookFlowStep[]> => {
  const result = new Map<string, import("../../types").HookFlowStep[]>();
  const fields = focusedField
    ? bodyAnalysis.returnFields.filter((field) => field.name === focusedField)
    : bodyAnalysis.returnFields;

  for (const field of fields) {
    const steps: import("../../types").HookFlowStep[] = [];

    if (bindingVariable) {
      steps.push({
        expression: `${bindingVariable}.${field.name}`,
        kind: "consumer-assign",
        label: `${bindingVariable}.${field.name}`,
      });
    }

    const sourceVar = resolveSourceVariable(
      field.expression,
      bodyAnalysis.variables
    );
    if (sourceVar) {
      if (sourceVar.hookName) {
        const isBuiltIn = isReactBuiltInHook(sourceVar.hookName);
        steps.push({
          builtInParamExpression: isBuiltIn
            ? sourceVar.argumentExpression
            : undefined,
          expression: sourceVar.expression,
          hookName: sourceVar.hookName,
          isBuiltIn,
          kind: "hook-call",
          label: isBuiltIn ? sourceVar.hookName : sourceVar.name,
          loc: sourceVar.loc,
          nestedHookName: isCustomHookName(sourceVar.hookName)
            ? sourceVar.hookName
            : undefined,
        });
      } else if (sourceVar.kind === "derived") {
        steps.push({
          expression: sourceVar.expression,
          kind: "derived",
          label: sourceVar.expression,
          loc: sourceVar.loc,
        });
      }

      for (const dep of sourceVar.dependencies) {
        const depVar = resolveSourceVariable(dep, bodyAnalysis.variables);
        if (depVar && depVar.name !== sourceVar.name) {
          steps.push({
            expression: dep,
            kind: "derived",
            label: dep,
          });
        }
      }
    } else if (field.expression !== field.name) {
      steps.push({
        expression: field.expression,
        kind: "derived",
        label: field.expression,
        loc: field.loc,
      });
    }

    steps.push({
      expression: field.name,
      kind: "return",
      label: field.name,
      loc: field.loc,
    });

    result.set(field.name, steps);
  }

  return result;
};
