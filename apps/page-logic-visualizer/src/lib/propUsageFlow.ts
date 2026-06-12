import type {
  PageLogicGraph,
  UiTreeNode,
} from "@cs/page-logic-visualizer/client";

import { matchesPropUsage } from "@/lib/propExpressionMatch";
import type { PropFlowNode } from "@/lib/propFlowGraph";

export interface PropPassDown {
  childNodeId: string;
  childLabel: string;
  propName: string;
  expression: string;
  renamed: boolean;
}

export interface UsageFlowBranch {
  edgeLabel: string;
  node: PropFlowNode;
  /** Render targets gated by a condition (e.g. Badge with children ← badge). */
  children?: UsageFlowBranch[];
}

export interface UsageFlowGraph {
  intake: PropFlowNode;
  branches: UsageFlowBranch[];
}

export type UsageFlowIntakeKind = "prop" | "variable";

const MAX_DETAIL_CHARS = 88;

const ellipsize = (text: string, max = MAX_DETAIL_CHARS): string => {
  const compact = text.replaceAll(/\s+/g, " ").trim();
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max - 1)}…`;
};

const normalizeFilePath = (filePath: string): string =>
  filePath.replaceAll("\\", "/");

const conditionInComponentFile = (
  conditionNodeId: string,
  componentFile: string
): boolean => conditionNodeId.replaceAll("\\", "/").includes(componentFile);

/** JSX passes written in this component source file (any JSX depth, not child file bodies). */
export const collectInComponentJsxPasses = (
  graph: PageLogicGraph,
  treeNode: UiTreeNode,
  componentNodeId: string,
  propName: string,
  dataExpression?: string
): PropPassDown[] => {
  const component = graph.nodes.find((node) => node.id === componentNodeId);
  const componentFile = component?.filePath
    ? normalizeFilePath(component.filePath)
    : undefined;
  if (!componentFile) {
    return [];
  }

  const passed: PropPassDown[] = [];
  const seen = new Set<string>();

  const visit = (node: UiTreeNode) => {
    for (const render of node.renders) {
      for (const prop of render.props) {
        if (/^on[A-Z]/.test(prop.name)) {
          continue;
        }
        if (render.label.includes("Provider") && prop.name === "value") {
          continue;
        }
        if (!matchesPropUsage(prop.expression, propName, dataExpression)) {
          continue;
        }
        const propFile = prop.loc?.filePath
          ? normalizeFilePath(prop.loc.filePath)
          : undefined;
        if (propFile && propFile !== componentFile) {
          continue;
        }
        const key = `${render.nodeId}:${prop.name}:${prop.expression}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        passed.push({
          childLabel: render.label,
          childNodeId: render.nodeId,
          expression: prop.expression,
          propName: prop.name,
          renamed: prop.name !== propName,
        });
      }
    }
    for (const child of node.children) {
      visit(child);
    }
  };

  visit(treeNode);
  return passed;
};

const groupPassesByChild = (
  passes: PropPassDown[]
): Map<string, PropPassDown[]> => {
  const map = new Map<string, PropPassDown[]>();
  for (const pass of passes) {
    const key = pass.childNodeId;
    const list = map.get(key) ?? [];
    list.push(pass);
    map.set(key, list);
  }
  return map;
};

const formatPassDetail = (passes: PropPassDown[]): string =>
  ellipsize(
    passes.map((pass) => `${pass.propName} ← ${pass.expression}`).join(", ")
  );

const formatConditionBranchLabel = (label: string): string => {
  if (label === "null (render nothing)") {
    return "null";
  }
  if (label.startsWith("<") || label === "null") {
    return label;
  }
  return `<${label}>`;
};

const resolveConditionBranchLabel = (
  graph: PageLogicGraph,
  conditionNodeId: string,
  branch: "true" | "false",
  conditionNode?: PageLogicGraph["nodes"][number]
): string => {
  const described = describeConditionTargets(graph, conditionNodeId, branch);
  if (described !== "<element>") {
    return described;
  }
  const output =
    branch === "true"
      ? conditionNode?.condition?.trueOutput
      : conditionNode?.condition?.falseOutput;
  if (!output) {
    return branch === "false" ? "null" : "<element>";
  }
  return formatConditionBranchLabel(output);
};

const conditionHasFalseArm = (
  graph: PageLogicGraph,
  conditionNode?: PageLogicGraph["nodes"][number]
): boolean => {
  if (!conditionNode) {
    return false;
  }
  if (conditionNode.condition?.kind === "ternary") {
    return true;
  }
  if (conditionNode.condition?.falseOutput) {
    return true;
  }
  return graph.edges.some(
    (edge) =>
      edge.source === conditionNode.id && edge.type === "condition-false"
  );
};

const describeConditionTargets = (
  graph: PageLogicGraph,
  conditionNodeId: string,
  branch: "true" | "false" = "true"
): string => {
  const edgeType = branch === "true" ? "condition-true" : "condition-false";
  const labels: string[] = [];

  for (const edge of graph.edges) {
    if (edge.source !== conditionNodeId || edge.type !== edgeType) {
      continue;
    }
    const target = graph.nodes.find((node) => node.id === edge.target);
    if (!target) {
      continue;
    }
    if (target.type === "loop") {
      for (const loopEdge of graph.edges) {
        if (loopEdge.source !== target.id || loopEdge.type !== "loop-renders") {
          continue;
        }
        const loopTarget = graph.nodes.find(
          (node) => node.id === loopEdge.target
        );
        if (loopTarget) {
          labels.push(loopTarget.label);
        }
      }
      continue;
    }
    labels.push(target.label);
  }

  if (labels.length === 0) {
    return "<element>";
  }
  return labels.map((label) => `<${label}>`).join(" ");
};

const findDisplayBindingDetail = (
  graph: PageLogicGraph,
  componentNodeId: string,
  propName: string,
  dataExpression?: string
): string | undefined => {
  for (const edge of graph.edges) {
    if (edge.source !== componentNodeId || edge.type !== "displays") {
      continue;
    }
    const target = graph.nodes.find((node) => node.id === edge.target);
    const bindsTo = target?.uiContent?.bindsTo;
    if (bindsTo && matchesPropUsage(bindsTo, propName, dataExpression)) {
      return `children ← ${bindsTo}`;
    }
  }
  return undefined;
};

const describeGatedComponentUsage = (
  graph: PageLogicGraph,
  uiNode: UiTreeNode,
  propName: string,
  dataExpression?: string
): string | undefined => {
  const childrenBinding = findDisplayBindingDetail(
    graph,
    uiNode.nodeId,
    propName,
    dataExpression
  );
  if (childrenBinding) {
    return childrenBinding;
  }

  const propUsages =
    uiNode.node.props?.filter((prop) =>
      matchesPropUsage(prop.expression, propName, dataExpression)
    ) ?? [];
  if (propUsages.length > 0) {
    return ellipsize(
      propUsages.map((prop) => `${prop.name} ← ${prop.expression}`).join(", ")
    );
  }

  return undefined;
};

const collectGatedConditionChildren = (
  graph: PageLogicGraph,
  treeNode: UiTreeNode,
  conditionNodeId: string,
  branch: "true" | "false",
  propName: string,
  dataExpression: string | undefined,
  nextId: (kind: string) => string
): UsageFlowBranch[] => {
  const targets: UsageFlowBranch[] = [];
  const seen = new Set<string>();

  const visit = (node: UiTreeNode) => {
    const gate = node.gateConditions.find(
      (item) =>
        item.conditionNodeId === conditionNodeId && item.branch === branch
    );
    if (gate && !seen.has(node.nodeId)) {
      seen.add(node.nodeId);
      const detail = describeGatedComponentUsage(
        graph,
        node,
        propName,
        dataExpression
      );
      targets.push({
        edgeLabel: detail?.startsWith("children") ? "children" : "render",
        node: {
          detail,
          id: nextId(`render:${node.node.label}`),
          label: node.node.label,
          loc: node.node.loc ?? gate.loc,
          nodeId: node.nodeId,
          stepRole: "pass-down",
        },
      });
    }
    for (const child of node.children) {
      visit(child);
    }
  };

  visit(treeNode);
  return targets;
};

const buildConditionBranchArm = (
  graph: PageLogicGraph,
  treeNode: UiTreeNode,
  conditionNode: PageLogicGraph["nodes"][number],
  branch: "true" | "false",
  propName: string,
  dataExpression: string | undefined,
  nextId: (kind: string) => string,
  loc?: PropFlowNode["loc"]
): UsageFlowBranch => {
  const gated = collectGatedConditionChildren(
    graph,
    treeNode,
    conditionNode.id,
    branch,
    propName,
    dataExpression,
    nextId
  );

  if (gated.length === 1) {
    const target = gated[0]!;
    return {
      edgeLabel: branch,
      node: {
        ...target.node,
        label: formatConditionBranchLabel(target.node.label),
      },
    };
  }

  if (gated.length > 1) {
    return {
      children: gated,
      edgeLabel: branch,
      node: {
        id: nextId(`branch:${branch}`),
        label: resolveConditionBranchLabel(
          graph,
          conditionNode.id,
          branch,
          conditionNode
        ),
        loc,
        nodeId: conditionNode.id,
        stepRole: "pass-down",
      },
    };
  }

  const label = resolveConditionBranchLabel(
    graph,
    conditionNode.id,
    branch,
    conditionNode
  );

  return {
    edgeLabel: branch,
    node: {
      detail: label === "null" ? "render nothing" : undefined,
      id: nextId(`branch:${branch}`),
      label,
      loc,
      nodeId: conditionNode.id,
      stepRole: "pass-down",
    },
  };
};

export const walkUsageFlowBranches = (
  branches: UsageFlowBranch[],
  visit: (branch: UsageFlowBranch) => void
): void => {
  for (const branch of branches) {
    visit(branch);
    walkUsageFlowBranches(branch.children ?? [], visit);
  }
};

const formatElementLabel = (
  parent: PageLogicGraph["nodes"][number]
): string => {
  const preview =
    typeof parent.metadata?.htmlPreview === "string"
      ? parent.metadata.htmlPreview
      : `<${parent.label}>`;
  return `Element: ${preview}`;
};

const isDirectElementTextBinding = (
  bindsTo: string,
  propName: string,
  dataExpression?: string
): boolean => {
  const trimmed = bindsTo.trim();
  const isDirect = (name: string) =>
    trimmed === name || trimmed === `{${name}}`;
  if (isDirect(propName)) {
    return true;
  }
  if (dataExpression && isDirect(dataExpression)) {
    return true;
  }
  return false;
};

const isGatedByMatchingCondition = (
  treeNode: UiTreeNode,
  propName: string,
  dataExpression: string | undefined,
  parentNodeId: string
): boolean => {
  const visit = (node: UiTreeNode): boolean => {
    const gated = node.gateConditions.some(
      (gate) =>
        node.nodeId === parentNodeId &&
        gate.inputs.some((input) =>
          matchesPropUsage(input, propName, dataExpression)
        )
    );
    if (gated) {
      return true;
    }
    for (const child of node.children) {
      if (visit(child)) {
        return true;
      }
    }
    return false;
  };
  return visit(treeNode);
};

const collectElementRenderUsages = (
  graph: PageLogicGraph,
  treeNode: UiTreeNode,
  componentFile: string,
  propName: string,
  dataExpression: string | undefined,
  nextId: (kind: string) => string
): UsageFlowBranch[] => {
  const branches: UsageFlowBranch[] = [];
  const seen = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.type !== "displays") {
      continue;
    }
    const content = graph.nodes.find((node) => node.id === edge.target);
    const parent = graph.nodes.find((node) => node.id === edge.source);
    const bindsTo = content?.uiContent?.bindsTo;
    if (!content || !parent || !bindsTo) {
      continue;
    }
    if (!isDirectElementTextBinding(bindsTo, propName, dataExpression)) {
      continue;
    }

    const contentFile = content.loc?.filePath
      ? normalizeFilePath(content.loc.filePath)
      : undefined;
    if (!contentFile || contentFile !== componentFile) {
      continue;
    }

    if (parent.metadata?.isHtml !== true) {
      continue;
    }

    if (
      isGatedByMatchingCondition(treeNode, propName, dataExpression, parent.id)
    ) {
      continue;
    }

    const key = parent.id;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    branches.push({
      edgeLabel: "render",
      node: {
        detail: `children ← ${bindsTo}`,
        id: nextId(`element:${parent.id}:${bindsTo}`),
        label: formatElementLabel(parent),
        loc: content.loc ?? parent.loc,
        nodeId: parent.id,
        stepRole: "pass-down",
      },
    });
  }

  return branches;
};

export const buildDownstreamUsageFlowGraph = (
  graph: PageLogicGraph,
  componentNodeId: string,
  propName: string,
  expression: string,
  treeNode: UiTreeNode | null,
  dataExpression?: string,
  options?: { intakeKind?: UsageFlowIntakeKind }
): UsageFlowGraph | null => {
  if (!treeNode) {
    return null;
  }

  const intakeKind = options?.intakeKind ?? "prop";
  const symbolMeta =
    intakeKind === "variable"
      ? treeNode.locals.variables.find((item) => item.name === propName)
      : treeNode.locals.props.find((item) => item.name === propName);
  const intake: PropFlowNode = {
    detail: expression,
    id: `${componentNodeId}:usage:intake`,
    label: propName,
    loc: symbolMeta?.loc,
    nodeId: componentNodeId,
    stepRole: intakeKind === "variable" ? "variable" : "prop",
  };

  const branches: UsageFlowBranch[] = [];
  let seq = 0;
  const nextId = (kind: string) => `${componentNodeId}:usage:${seq++}:${kind}`;

  const hookArgsSeen = new Set<string>();

  for (const hook of treeNode.locals.hooks) {
    if (
      !hook.expression ||
      !matchesPropUsage(hook.expression, propName, dataExpression)
    ) {
      continue;
    }
    const key = hook.expression.trim();
    if (hookArgsSeen.has(key)) {
      continue;
    }
    hookArgsSeen.add(key);
    branches.push({
      edgeLabel: "argument",
      node: {
        detail: hook.name !== hook.expression ? hook.name : undefined,
        id: nextId("argument"),
        label: ellipsize(hook.expression, 96),
        loc: hook.loc,
        nodeId: componentNodeId,
        stepRole: "call",
      },
    });
  }

  for (const fn of treeNode.locals.functions) {
    if (
      !fn.expression ||
      !matchesPropUsage(fn.expression, propName, dataExpression)
    ) {
      continue;
    }
    const isHandler = /^on[A-Z]/.test(fn.name);
    branches.push({
      edgeLabel: isHandler ? "handler" : "argument",
      node: {
        detail: fn.name,
        id: nextId(isHandler ? "handler" : "argument"),
        label: ellipsize(fn.expression, 96),
        loc: fn.loc,
        nodeId: componentNodeId,
        stepRole: isHandler ? "call" : "call",
      },
    });
  }

  for (const variable of treeNode.locals.variables) {
    if (
      variable.name === propName ||
      !variable.expression ||
      !matchesPropUsage(variable.expression, propName, dataExpression)
    ) {
      continue;
    }
    const viaHook = variable.sourceHook
      ? `via ${variable.sourceHook}`
      : undefined;
    branches.push({
      edgeLabel: "computes",
      node: {
        detail: ellipsize(variable.expression),
        id: nextId(`derive:${variable.name}`),
        label: variable.name,
        loc: variable.loc,
        nodeId: componentNodeId,
        stepRole: "derive",
        transitionLabel: viaHook,
      },
    });
  }

  if (
    treeNode.node.loop &&
    matchesPropUsage(
      treeNode.node.loop.sourceExpression,
      propName,
      dataExpression
    )
  ) {
    branches.push({
      edgeLabel: "iterates",
      node: {
        detail: treeNode.node.loop.itemName
          ? `item: ${treeNode.node.loop.itemName}`
          : undefined,
        id: nextId("loop"),
        label: ellipsize(treeNode.node.loop.sourceExpression, 96),
        nodeId: componentNodeId,
        stepRole: "loop",
      },
    });
  }

  const conditionSeen = new Set<string>();
  const pushCondition = (
    conditionNodeId: string,
    condExpression: string,
    loc?: PropFlowNode["loc"]
  ) => {
    if (conditionSeen.has(conditionNodeId)) {
      return;
    }
    conditionSeen.add(conditionNodeId);

    const conditionNode = graph.nodes.find(
      (node) => node.id === conditionNodeId
    );
    const branchChildren: UsageFlowBranch[] = [];

    if (conditionNode) {
      branchChildren.push(
        buildConditionBranchArm(
          graph,
          treeNode,
          conditionNode,
          "true",
          propName,
          dataExpression,
          nextId,
          loc
        )
      );
      if (conditionHasFalseArm(graph, conditionNode)) {
        branchChildren.push(
          buildConditionBranchArm(
            graph,
            treeNode,
            conditionNode,
            "false",
            propName,
            dataExpression,
            nextId,
            loc
          )
        );
      }
    }

    branches.push({
      children: branchChildren.length > 0 ? branchChildren : undefined,
      edgeLabel: "condition",
      node: {
        id: nextId("condition"),
        label: ellipsize(condExpression, 96),
        loc,
        nodeId: conditionNodeId,
        stepRole: "branch",
      },
    });
  };

  if (
    treeNode.node.type === "condition" &&
    treeNode.node.condition?.inputs?.some((input) =>
      matchesPropUsage(input, propName, dataExpression)
    )
  ) {
    pushCondition(
      treeNode.node.id,
      treeNode.node.condition.expression,
      treeNode.node.loc
    );
  }

  const component = graph.nodes.find((node) => node.id === componentNodeId);
  const componentFile = component?.filePath
    ? normalizeFilePath(component.filePath)
    : "";

  const visitLocalConditions = (node: UiTreeNode) => {
    for (const local of node.localConditions) {
      const matchesInput = local.inputs.some((input) =>
        matchesPropUsage(input, propName, dataExpression)
      );
      const matchesExpr = matchesPropUsage(
        local.expression,
        propName,
        dataExpression
      );
      if (!matchesInput && !matchesExpr) {
        continue;
      }
      if (
        componentFile &&
        !conditionInComponentFile(local.conditionNodeId, componentFile)
      ) {
        continue;
      }
      pushCondition(local.conditionNodeId, local.expression, local.loc);
    }
    for (const child of node.children) {
      visitLocalConditions(child);
    }
  };
  visitLocalConditions(treeNode);

  const visitProviderRenders = (node: UiTreeNode) => {
    for (const render of node.renders) {
      if (!render.label.includes("Provider")) {
        continue;
      }
      const valueProp = render.props.find((prop) => prop.name === "value");
      if (
        !valueProp ||
        !matchesPropUsage(valueProp.expression, propName, dataExpression)
      ) {
        continue;
      }
      branches.push({
        edgeLabel: "provider",
        node: {
          detail: ellipsize(valueProp.expression),
          id: nextId("provider"),
          label: render.label,
          loc: valueProp.loc,
          nodeId: componentNodeId,
          stepRole: "context",
        },
      });
    }
    for (const child of node.children) {
      visitProviderRenders(child);
    }
  };
  visitProviderRenders(treeNode);

  const handlerSeen = new Set<string>();
  const visitHandlerProps = (node: UiTreeNode) => {
    for (const render of node.renders) {
      for (const prop of render.props) {
        if (!/^on[A-Z]/.test(prop.name)) {
          continue;
        }
        if (!matchesPropUsage(prop.expression, propName, dataExpression)) {
          continue;
        }
        const key = `${render.nodeId}:${prop.name}`;
        if (handlerSeen.has(key)) {
          continue;
        }
        handlerSeen.add(key);
        branches.push({
          edgeLabel: "handler",
          node: {
            detail: prop.expression,
            id: nextId(`handler:${render.label}:${prop.name}`),
            label: `${render.label}.${prop.name}`,
            loc: prop.loc,
            nodeId: render.nodeId,
            stepRole: "call",
          },
        });
      }
    }
    for (const child of node.children) {
      visitHandlerProps(child);
    }
  };
  visitHandlerProps(treeNode);

  if (componentFile) {
    branches.push(
      ...collectElementRenderUsages(
        graph,
        treeNode,
        componentFile,
        propName,
        dataExpression,
        nextId
      )
    );
  }

  const passes = collectInComponentJsxPasses(
    graph,
    treeNode,
    componentNodeId,
    propName,
    dataExpression
  );

  for (const [childNodeId, childPasses] of groupPassesByChild(passes)) {
    const sample = childPasses[0]!;
    const findRender = (
      node: UiTreeNode
    ): (typeof node.renders)[0] | undefined => {
      const direct = node.renders.find((item) => item.nodeId === childNodeId);
      if (direct) {
        return direct;
      }
      for (const child of node.children) {
        const nested = findRender(child);
        if (nested) {
          return nested;
        }
      }
      return undefined;
    };
    const render = findRender(treeNode);
    const propLoc =
      render?.props.find((prop) =>
        childPasses.some((pass) => pass.propName === prop.name)
      )?.loc ?? render?.props[0]?.loc;

    branches.push({
      edgeLabel: "pass",
      node: {
        detail: formatPassDetail(childPasses),
        id: nextId(`pass:${childNodeId}`),
        label: sample.childLabel,
        loc: propLoc,
        nodeId: componentNodeId,
        stepRole: "pass-down",
      },
    });
  }

  return { branches, intake };
};
