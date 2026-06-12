import { buildAllTraceLayers } from "../graph/traceLayers";
import { buildUiTree, flattenUiTree } from "../graph/uiGraph";
import type {
  GraphSearchResult,
  PageLogicGraph,
  SearchResultKind,
  TraceLayer,
} from "../types";

export type SearchScope =
  | "all"
  | "routes"
  | "components"
  | "hooks"
  | "variables"
  | "apis"
  | "events"
  | "files"
  | "packages";

const scopeToKinds: Record<SearchScope, SearchResultKind[] | null> = {
  all: null,
  apis: ["api"],
  components: ["component"],
  events: ["event"],
  files: ["file"],
  hooks: ["hook"],
  packages: ["package"],
  routes: ["route"],
  variables: ["variable"],
};

export interface SearchGraphOptions {
  query: string;
  scope?: SearchScope;
  limit?: number;
}

export const searchGraph = (
  graph: PageLogicGraph,
  options: SearchGraphOptions
): GraphSearchResult[] => {
  const normalized = options.query.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const allowedKinds = scopeToKinds[options.scope ?? "all"];
  const results: GraphSearchResult[] = [];
  const seen = new Set<string>();
  const limit = options.limit ?? 40;

  const push = (result: GraphSearchResult) => {
    if (seen.has(result.id)) {
      return;
    }
    if (allowedKinds && !allowedKinds.includes(result.kind)) {
      return;
    }
    seen.add(result.id);
    results.push(result);
  };

  for (const entry of graph.routeChain ?? []) {
    if (
      entry.label.toLowerCase().includes(normalized) ||
      entry.filePath.toLowerCase().includes(normalized)
    ) {
      push({
        detail: entry.filePath,
        file: entry.filePath,
        id: `route:${entry.nodeId}`,
        kind: "route",
        label: entry.label,
        layer: "route",
        nodeId: entry.nodeId,
      });
    }
  }

  for (const node of graph.nodes) {
    if (
      node.type === "component" ||
      node.type === "page" ||
      node.type === "layout"
    ) {
      if (
        node.label.toLowerCase().includes(normalized) ||
        node.filePath?.toLowerCase().includes(normalized)
      ) {
        push({
          detail: node.filePath,
          file: node.filePath,
          id: `component:${node.id}`,
          kind: "component",
          label: node.label,
          layer: "component",
          nodeId: node.id,
        });
      }
    }

    if (node.type === "hook" && node.hook) {
      if (
        node.hook.hookName.toLowerCase().includes(normalized) ||
        node.hook.callExpression.toLowerCase().includes(normalized)
      ) {
        push({
          detail: node.filePath,
          file: node.filePath,
          id: `hook:${node.id}`,
          kind: "hook",
          label: node.hook.hookName,
          layer: "hook",
          nodeId: node.id,
        });
      }
    }

    if (node.type === "data-fetch" && node.dataFetch) {
      if (
        node.dataFetch.functionName.toLowerCase().includes(normalized) ||
        node.dataFetch.callExpression.toLowerCase().includes(normalized)
      ) {
        push({
          detail: node.dataFetch.callExpression,
          file: node.filePath,
          id: `api:${node.id}`,
          kind: "api",
          label: node.dataFetch.functionName,
          layer: "data-source",
          nodeId: node.id,
        });
      }
    }

    if (node.packageName?.toLowerCase().includes(normalized)) {
      push({
        detail: node.importPath,
        file: node.filePath,
        id: `package:${node.id}`,
        kind: "package",
        label: node.packageName,
        layer: "dependency",
        nodeId: node.id,
      });
    }
  }

  const uiTree = buildUiTree(graph);
  if (uiTree) {
    for (const treeNode of flattenUiTree(uiTree)) {
      for (const item of [
        ...treeNode.locals.variables,
        ...treeNode.locals.props,
        ...treeNode.locals.functions,
      ]) {
        if (
          item.name.toLowerCase().includes(normalized) ||
          item.expression?.toLowerCase().includes(normalized)
        ) {
          push({
            detail: item.expression ?? treeNode.node.filePath,
            file: treeNode.node.filePath,
            id: `variable:${treeNode.nodeId}:${item.name}`,
            kind: "variable",
            label: item.name,
            layer: "data-flow",
            nodeId: treeNode.nodeId,
          });
        }
      }

      for (const render of treeNode.renders) {
        for (const prop of render.props) {
          if (!/^on[A-Z]/.test(prop.name)) {
            continue;
          }
          if (
            prop.name.toLowerCase().includes(normalized) ||
            prop.expression.toLowerCase().includes(normalized)
          ) {
            push({
              detail: prop.expression,
              file: treeNode.node.filePath,
              id: `event:${treeNode.nodeId}:${prop.name}`,
              kind: "event",
              label: `${render.label}.${prop.name}`,
              layer: "event-action",
              nodeId: treeNode.nodeId,
            });
          }
        }
      }
    }
  }

  for (const file of graph.files) {
    if (file.filePath.toLowerCase().includes(normalized)) {
      push({
        detail: `${file.importCount} imports`,
        file: file.filePath,
        id: `file:${file.filePath}`,
        kind: "file",
        label: file.filePath.split("/").pop() ?? file.filePath,
        layer: "dependency",
      });
    }
  }

  const layers = buildAllTraceLayers(graph);
  for (const layer of Object.keys(layers) as TraceLayer[]) {
    for (const node of layers[layer].nodes) {
      if (
        node.label.toLowerCase().includes(normalized) ||
        node.file?.toLowerCase().includes(normalized)
      ) {
        const kind = layerToSearchKind(layer, node.type);
        push({
          detail: node.file,
          file: node.file,
          id: `layer:${node.id}`,
          kind,
          label: node.label,
          layer,
        });
      }
    }
  }

  return results.slice(0, limit);
};

const layerToSearchKind = (
  layer: TraceLayer,
  nodeType: string
): SearchResultKind => {
  if (layer === "event-action") {
    return "event";
  }
  if (layer === "data-source") {
    return "api";
  }
  if (layer === "dependency") {
    return nodeType.includes("package") ? "package" : "file";
  }
  if (layer === "data-flow" || layer === "state-store") {
    return "variable";
  }
  if (layer === "hook") {
    return "hook";
  }
  if (layer === "route") {
    return "route";
  }
  return "component";
};
