import type {
  LogicGraphEdge,
  LogicGraphEdgeType,
  LogicGraphNode,
  PageLogicGraph,
  SourceFileMeta,
  AnalyzerWarning,
} from "../types";

let edgeCounter = 0;

export class GraphBuilder {
  private readonly nodes = new Map<string, LogicGraphNode>();
  private readonly edges: LogicGraphEdge[] = [];
  private readonly files = new Map<string, SourceFileMeta>();
  private readonly warnings: AnalyzerWarning[] = [];
  private readonly shallowPreviewStack: string[] = [];

  addNode(node: LogicGraphNode): LogicGraphNode {
    const shallowPreviewAnchorId = this.shallowPreviewStack.at(-1) ?? null;
    if (shallowPreviewAnchorId) {
      node.metadata = {
        ...node.metadata,
        shallowPreview: true,
        shallowPreviewOf: shallowPreviewAnchorId,
      };
    }
    this.nodes.set(node.id, node);
    return node;
  }

  beginShallowPreview(anchorNodeId: string): void {
    this.shallowPreviewStack.push(anchorNodeId);
  }

  endShallowPreview(): void {
    this.shallowPreviewStack.pop();
  }

  getNode(id: string): LogicGraphNode | undefined {
    return this.nodes.get(id);
  }

  getEdges(): LogicGraphEdge[] {
    return this.edges;
  }

  addEdge(
    source: string,
    target: string,
    type: LogicGraphEdgeType,
    label?: string
  ): LogicGraphEdge {
    edgeCounter += 1;
    const edge: LogicGraphEdge = {
      id: `edge:${edgeCounter}:${source}->${target}`,
      label,
      source,
      target,
      type,
    };
    this.edges.push(edge);
    return edge;
  }

  addWarning(warning: AnalyzerWarning): void {
    this.warnings.push(warning);
  }

  trackFile(meta: SourceFileMeta): void {
    this.files.set(meta.filePath, meta);
  }

  toGraph(rootNodeId: string, entryFile: string): PageLogicGraph {
    return {
      edges: this.edges,
      entryFile,
      files: [...this.files.values()],
      nodes: [...this.nodes.values()],
      rootNodeId,
      warnings: this.warnings,
    };
  }
}

export const createNodeId = (parts: {
  type: string;
  filePath?: string;
  name: string;
  line?: number;
  column?: number;
}): string => {
  const location =
    parts.line !== undefined && parts.column !== undefined
      ? `:${parts.line}:${parts.column}`
      : "";
  const file = parts.filePath ? `:${parts.filePath}` : "";
  return `${parts.type}${file}:${parts.name}${location}`;
};
