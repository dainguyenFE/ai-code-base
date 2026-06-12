import type {
  DataTraceChain,
  DataTraceStep,
  LogicGraphNode,
  PageLogicGraph,
  SourceLocation,
  UiLocalItem,
} from "@cs/page-logic-visualizer/client";
import {
  resolveConsumerAnchorId,
  resolveImmediatePropLoc,
} from "@cs/page-logic-visualizer/client";

export type LocalItemTone = "props" | "variables" | "functions" | "hooks";

export interface SourceViewTarget {
  filePath: string;
  startLine?: number;
  endLine?: number;
  /** Resolve symbol via import from this file when needed */
  parentFilePath?: string;
  /** Search for this symbol if line range is missing */
  symbolName?: string;
  /** Search for this text in the file (e.g. prop expression) */
  searchText?: string;
  label?: string;
}

export interface TraceStepFocusMeta {
  label?: string;
  stepRole?: string;
  loc?: SourceLocation;
  searchText?: string;
  sourceFilePath?: string;
  skipSourceLink?: boolean;
  skipSourceReason?: string;
  definitionFilePath?: string;
  definitionSymbol?: string;
  /** Hook node id for searchText fallback when trace is inline (no active sidebar) */
  contextHookNodeId?: string;
}

const BUILTIN_HOOK_SOURCE_NOTICE =
  "Built-in React hook — no source definition in this project";

const flattenTraceSteps = (steps: DataTraceStep[]): DataTraceStep[] => {
  const flat: DataTraceStep[] = [];
  for (const step of steps) {
    flat.push(step);
    if (step.children?.length) {
      flat.push(...flattenTraceSteps(step.children));
    }
  }
  return flat;
};

const rootIdentifier = (expression: string): string => {
  const match = expression.match(/^([a-zA-Z_$][\w$]*)/);
  return match?.[1] ?? expression;
};

/** Default step to focus when opening a new data trace (prefers upstream `data` assignment). */
export const pickDefaultTraceStep = (
  chain: DataTraceChain
): DataTraceStep | undefined => {
  const flat = flattenTraceSteps(chain.steps);
  return (
    flat.find(
      (step) => step.stepRole === "variable" && step.label === "data"
    ) ??
    flat.find((step) => step.stepRole === "variable") ??
    flat.find((step) => step.loc) ??
    flat[0]
  );
};

/** Step to focus when opening trace from a UI card chip — the prop/variable being traced. */
export const pickInitialTraceStep = (
  chain: DataTraceChain,
  options?: {
    consumerNodeId?: string;
    propName?: string;
  }
): DataTraceStep | undefined => {
  const consumerId = options?.consumerNodeId ?? chain.consumerNodeId;
  const tracedLabel = options?.propName ?? rootIdentifier(chain.expression);
  const flat = flattenTraceSteps(chain.steps);

  if (consumerId && options?.propName) {
    const atConsumer = flat.find(
      (step) =>
        step.stepRole === "prop" &&
        step.label === options.propName &&
        step.nodeId === `${consumerId}:prop:${options.propName}`
    );
    if (atConsumer) {
      return atConsumer;
    }
  }

  if (consumerId) {
    const atConsumer = flat.find(
      (step) =>
        step.nodeId === `${consumerId}:local:${tracedLabel}` ||
        step.nodeId === `${consumerId}:expr:${tracedLabel}` ||
        ((step.stepRole === "prop" || step.stepRole === "variable") &&
          step.label === tracedLabel &&
          step.nodeId.startsWith(`${consumerId}:`))
    );
    if (atConsumer) {
      return atConsumer;
    }
  }

  const consumerSide = chain.steps.find(
    (step) =>
      (step.stepRole === "prop" || step.stepRole === "variable") &&
      step.label === tracedLabel
  );
  if (consumerSide) {
    return consumerSide;
  }

  return pickDefaultTraceStep(chain);
};

export const traceStepFocusMeta = (
  step: DataTraceStep
): TraceStepFocusMeta => ({
  definitionFilePath: step.definitionFilePath,
  definitionSymbol: step.definitionSymbol,
  label: step.label,
  loc: step.loc,
  searchText: step.searchText,
  skipSourceLink: step.skipSourceLink,
  skipSourceReason: step.skipSourceReason,
  sourceFilePath: step.sourceFilePath,
  stepRole: step.stepRole,
});

const DEFINITION_NODE_TYPES = new Set([
  "component",
  "page",
  "layout",
  "hook",
  "data-fetch",
]);

const normalizeFilePath = (filePath: string): string =>
  filePath.replaceAll("\\", "/");

/** Strip absolute prefix so paths match graph entries and API expectations. */
export const toRepoRelativePath = (filePath: string): string => {
  const normalized = normalizeFilePath(filePath);
  for (const marker of ["/apps/", "/packages/"]) {
    const index = normalized.indexOf(marker);
    if (index !== -1) {
      return normalized.slice(index + 1);
    }
  }
  return normalized;
};

export const sourceTargetFromLocation = (
  loc: SourceLocation,
  label?: string
): SourceViewTarget => ({
  endLine: loc.endLine,
  filePath: toRepoRelativePath(loc.filePath),
  label,
  startLine: loc.startLine,
});

export const sourceTargetFromNode = (
  node: LogicGraphNode
): SourceViewTarget | null => {
  const filePath =
    node.filePath ?? node.dataFetch?.resolvedFilePath ?? node.loc?.filePath;

  if (!filePath) {
    return null;
  }

  const symbolName =
    node.exportName ??
    (node.type === "hook" || node.type === "component" || node.type === "page"
      ? node.label
      : (node.type === "data-fetch"
        ? node.dataFetch?.functionName
        : undefined));

  const isHtmlNode = node.metadata?.isHtml === true;
  const jumpToDefinition = DEFINITION_NODE_TYPES.has(node.type) && !isHtmlNode;

  if (node.loc && !jumpToDefinition) {
    return sourceTargetFromLocation(node.loc, node.label);
  }

  return {
    endLine: jumpToDefinition ? undefined : node.loc?.endLine,
    filePath: toRepoRelativePath(filePath),
    label: node.label,
    startLine: jumpToDefinition ? undefined : node.loc?.startLine,
    symbolName,
  };
};

const TRACE_STEP_SUFFIX =
  /:(?:prop:[^:]+|var|literal:.+|nested:.+|data:.+|inbound:[^:]+:[^:]+)$/;

export const resolveGraphNodeById = (
  graph: PageLogicGraph,
  nodeId: string
): LogicGraphNode | undefined => {
  const direct = graph.nodes.find((item) => item.id === nodeId);
  if (direct) {
    return direct;
  }

  const withoutSuffix = nodeId.replace(TRACE_STEP_SUFFIX, "");
  if (withoutSuffix !== nodeId) {
    return graph.nodes.find((item) => item.id === withoutSuffix);
  }

  return undefined;
};

export const sourceTargetFromNodeId = (
  graph: PageLogicGraph,
  nodeId: string
): SourceViewTarget | null => {
  const node = resolveGraphNodeById(graph, nodeId);
  if (!node) {
    return null;
  }
  return sourceTargetFromNode(node);
};

export const sourceTargetFromTraceStep = (
  graph: PageLogicGraph,
  nodeId: string,
  meta?: TraceStepFocusMeta
): SourceViewTarget | null => {
  if (meta?.skipSourceLink) {
    return null;
  }

  if (meta?.definitionFilePath && meta.definitionSymbol) {
    return {
      filePath: toRepoRelativePath(meta.definitionFilePath),
      label: meta.label ?? meta.definitionSymbol,
      symbolName: meta.definitionSymbol,
    };
  }

  if (meta?.loc) {
    return sourceTargetFromLocation(meta.loc, meta.label);
  }

  if (meta?.searchText && meta.sourceFilePath) {
    return {
      filePath: normalizeFilePath(meta.sourceFilePath),
      label: meta.label,
      searchText: meta.searchText,
    };
  }

  const label = meta?.label;
  const stepRole = meta?.stepRole;

  const nestedMatch = nodeId.match(/^(.+):nested:(.+)$/);
  if (nestedMatch?.[1] && nestedMatch[2]) {
    const baseNode = graph.nodes.find((item) => item.id === nestedMatch[1]);
    const fnName = nestedMatch[2];
    const filePath =
      baseNode?.dataFetch?.resolvedFilePath ?? baseNode?.filePath;
    if (filePath) {
      return {
        filePath: normalizeFilePath(filePath),
        label: `${fnName}()`,
        parentFilePath: normalizeFilePath(filePath),
        symbolName: fnName,
      };
    }
  }

  if (stepRole === "api-call" && label) {
    const urlMatch = label.match(/\s(\/[\w./-]+)/);
    const searchText = urlMatch?.[1] ?? label;
    for (const file of graph.files) {
      return {
        filePath: normalizeFilePath(file.filePath),
        label,
        searchText,
      };
    }
  }

  if (stepRole === "await-call" || stepRole === "function") {
    const symbolMatch = label?.match(/(?:await\s+)?(\w+)\(\)/);
    const symbolName = symbolMatch?.[1];
    const treeFnMatch = nodeId.match(/:tree:function:([^:]+)$/);
    const treeFnName = treeFnMatch?.[1];

    if (meta?.sourceFilePath && (symbolName ?? treeFnName)) {
      return {
        filePath: normalizeFilePath(meta.sourceFilePath),
        label: label ?? `${treeFnName ?? symbolName}()`,
        symbolName: symbolName ?? treeFnName,
      };
    }

    const fromNode = sourceTargetFromNodeId(graph, nodeId);
    if (fromNode && symbolName) {
      return { ...fromNode, symbolName };
    }
  }

  if (meta?.searchText) {
    const fromNode = sourceTargetFromNodeId(graph, nodeId);
    if (fromNode?.filePath) {
      return {
        ...fromNode,
        label: meta.label ?? fromNode.label,
        searchText: meta.searchText,
      };
    }
  }

  return sourceTargetFromNodeId(graph, nodeId);
};

export interface TraceFocusResult {
  notice: string | null;
  target: SourceViewTarget | null;
}

export const resolveTraceFocus = (
  graph: PageLogicGraph,
  nodeId: string | undefined,
  meta?: TraceStepFocusMeta
): TraceFocusResult => {
  if (meta?.skipSourceLink) {
    return {
      notice: meta.skipSourceReason ?? BUILTIN_HOOK_SOURCE_NOTICE,
      target: null,
    };
  }

  if (nodeId) {
    const fromStep = sourceTargetFromTraceStep(graph, nodeId, meta);
    if (fromStep) {
      return { notice: null, target: fromStep };
    }
  }

  if (meta?.definitionFilePath && meta.definitionSymbol) {
    return {
      notice: null,
      target: {
        filePath: toRepoRelativePath(meta.definitionFilePath),
        label: meta.label ?? meta.definitionSymbol,
        symbolName: meta.definitionSymbol,
      },
    };
  }

  if (meta?.loc) {
    return {
      notice: null,
      target: sourceTargetFromLocation(meta.loc, meta.label),
    };
  }

  if (meta?.searchText) {
    const hookNodeId = meta.contextHookNodeId ?? nodeId;
    if (hookNodeId) {
      const fromNode = sourceTargetFromNodeId(graph, hookNodeId);
      if (fromNode) {
        return {
          notice: null,
          target: {
            ...fromNode,
            label: meta.label ?? fromNode.label,
            searchText: meta.searchText,
          },
        };
      }
    }
  }

  if (nodeId) {
    const fromNode = sourceTargetFromNodeId(graph, nodeId);
    if (fromNode) {
      return { notice: null, target: fromNode };
    }
  }

  return { notice: null, target: null };
};

export const sourceTargetForDataUse = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  expression: string
): SourceViewTarget | null => {
  const node = graph.nodes.find((item) => item.id === consumerNodeId);
  if (!node) {
    return null;
  }

  const anchorId = resolveConsumerAnchorId(graph, consumerNodeId);
  const anchor = graph.nodes.find((item) => item.id === anchorId) ?? node;

  const propNameFromExpression = anchor.props?.find(
    (item) =>
      item.expression === expression ||
      item.expression.includes(expression) ||
      expression.includes(item.name)
  )?.name;

  const immediatePropLoc =
    propNameFromExpression !== undefined
      ? resolveImmediatePropLoc(graph, consumerNodeId, propNameFromExpression)
      : resolveImmediatePropLoc(graph, consumerNodeId, expression);

  if (immediatePropLoc) {
    return sourceTargetFromLocation(
      immediatePropLoc,
      `${expression} · ${node.label}`
    );
  }

  const filePath = anchor.loc?.filePath ?? anchor.filePath;
  if (!filePath) {
    return null;
  }

  const prop = anchor.props?.find(
    (item) =>
      item.expression === expression ||
      item.expression.includes(expression) ||
      expression.includes(item.name)
  );

  if (prop?.loc) {
    return sourceTargetFromLocation(
      prop.loc,
      `${expression} · ${anchor.label}`
    );
  }

  return {
    endLine: anchor.loc?.endLine,
    filePath: normalizeFilePath(filePath),
    label: `${expression} · ${anchor.label}`,
    searchText: prop?.expression ?? expression,
    startLine: anchor.loc?.startLine,
  };
};

export const sourceTargetForLocalItem = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  item: UiLocalItem,
  tone: LocalItemTone
): SourceViewTarget | null => {
  const consumer = graph.nodes.find((node) => node.id === consumerNodeId);
  const consumerFile = consumer?.filePath ?? consumer?.loc?.filePath;

  if (tone === "hooks" && item.nodeId) {
    const hookTarget = sourceTargetFromNodeId(graph, item.nodeId);
    if (hookTarget) {
      return hookTarget;
    }
  }

  if (tone === "variables" || tone === "functions" || tone === "props") {
    const usageTarget = sourceTargetForDataUse(
      graph,
      consumerNodeId,
      item.expression ?? item.name
    );
    if (usageTarget) {
      return usageTarget;
    }
  }

  if (item.nodeId) {
    const linkedTarget = sourceTargetFromNodeId(graph, item.nodeId);
    if (linkedTarget) {
      return linkedTarget;
    }
  }

  if (!consumerFile) {
    return null;
  }

  return {
    filePath: normalizeFilePath(consumerFile),
    label: `${item.name} · ${consumer?.label ?? consumerNodeId}`,
    searchText: item.expression ?? item.name,
    symbolName:
      tone === "props" ? (consumer?.exportName ?? consumer?.label) : undefined,
  };
};
