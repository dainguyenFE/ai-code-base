import path from "node:path";

import { Project as TsMorphProject } from "ts-morph";
import type { Project, SourceFile } from "ts-morph";

import { isStoreHook } from "../analyzer/analyzeDataSources";
import {
  analyzeStoreFieldEffectDeps,
  analyzeStoreWritesInBody,
  loadBodyFromSourceFile,
  setterNameForField,
} from "../analyzer/analyzeStoreWrites";
import type {
  PageLogicGraph,
  StoreFieldWriterTrace,
  StoreWriteSite,
  UiTreeNode,
} from "../types";
import {
  findTsConfigForFile,
  normalizePath,
  resolveFromRoot,
} from "../utils/path";
import { buildUiTree, flattenUiTree } from "./uiGraph";

export interface StoreScanTarget {
  filePath: string;
  ownerLabel: string;
  graphNodeId?: string;
}

export const collectPageReachableNodeIds = (
  uiTree: UiTreeNode | null
): Set<string> => {
  const ids = new Set<string>();
  if (!uiTree) {
    return ids;
  }
  for (const node of flattenUiTree(uiTree)) {
    ids.add(node.nodeId);
  }
  return ids;
};

const resolveHookDefinitionFile = (
  graph: PageLogicGraph,
  hookName: string
): string | undefined => {
  const hookNode = graph.nodes.find(
    (node) => node.type === "hook" && node.label === hookName && node.filePath
  );
  if (hookNode?.filePath) {
    return hookNode.filePath;
  }

  const normalizedHook = hookName.toLowerCase();
  for (const node of graph.nodes) {
    if (!node.filePath) {
      continue;
    }
    const file = node.filePath.replaceAll("\\", "/").toLowerCase();
    if (
      file.endsWith(`/hooks/${normalizedHook}.ts`) ||
      file.endsWith(`/hooks/${normalizedHook}.tsx`) ||
      file.endsWith(`/${normalizedHook}.ts`) ||
      file.endsWith(`/${normalizedHook}.tsx`)
    ) {
      return node.filePath;
    }
  }

  return undefined;
};

/** Files/components/hooks reachable on the analyzed route (page scope). */
export const collectPageScopeScanTargets = (
  graph: PageLogicGraph,
  uiTree?: UiTreeNode | null
): StoreScanTarget[] => {
  const tree = uiTree ?? buildUiTree(graph);
  const reachable = collectPageReachableNodeIds(tree);
  const targets = new Map<string, StoreScanTarget>();

  const addTarget = (target: StoreScanTarget): void => {
    const key = `${target.filePath}:${target.ownerLabel}`;
    if (!targets.has(key)) {
      targets.set(key, target);
    }
  };

  for (const nodeId of reachable) {
    const graphNode = graph.nodes.find((node) => node.id === nodeId);
    if (graphNode?.filePath) {
      addTarget({
        filePath: graphNode.filePath,
        graphNodeId: graphNode.id,
        ownerLabel: graphNode.label,
      });
    }
  }

  if (tree) {
    for (const treeNode of flattenUiTree(tree)) {
      for (const local of treeNode.locals.variables) {
        if (!local.sourceHook) {
          continue;
        }
        const hookFile = resolveHookDefinitionFile(graph, local.sourceHook);
        if (hookFile) {
          addTarget({
            filePath: hookFile,
            ownerLabel: local.sourceHook,
          });
        }
      }
      for (const hook of treeNode.locals.hooks) {
        const hookFile = resolveHookDefinitionFile(graph, hook.name);
        if (hookFile) {
          addTarget({
            filePath: hookFile,
            ownerLabel: hook.name,
          });
        }
      }
    }
  }

  return [...targets.values()];
};

const getProject = (
  rootDir: string,
  entryFile: string,
  tsConfigPath?: string
): Project => {
  const configPath =
    tsConfigPath ??
    findTsConfigForFile(rootDir, entryFile) ??
    `${rootDir}/tsconfig.json`;
  return new TsMorphProject({
    skipAddingFilesFromTsConfig: true,
    tsConfigFilePath: configPath,
  });
};

const loadSourceFile = (
  project: Project,
  absolutePath: string
): SourceFile | undefined =>
  project.getSourceFile(absolutePath) ??
  project.addSourceFileAtPathIfExists(absolutePath) ??
  undefined;

/** Trace store field writes and reactive effect deps, limited to current route scope. */
export const buildStoreFieldWriterTrace = (
  graph: PageLogicGraph,
  storeField: string,
  options: {
    rootDir: string;
    tsConfigPath?: string;
    uiTree?: UiTreeNode | null;
    storeHook?: string;
    project?: Project;
  }
): StoreFieldWriterTrace => {
  const uiTree = options.uiTree ?? buildUiTree(graph);
  const scanTargets = collectPageScopeScanTargets(graph, uiTree);
  const entryFile = graph.entryFile ?? scanTargets[0]?.filePath ?? "";
  const project =
    options.project ??
    getProject(options.rootDir, entryFile, options.tsConfigPath);

  const writers: StoreWriteSite[] = [];
  const reactiveTriggers: StoreWriteSite[] = [];
  const seenWriter = new Set<string>();
  const seenTrigger = new Set<string>();

  for (const target of scanTargets) {
    const absolutePath = normalizePath(
      resolveFromRoot(options.rootDir, target.filePath)
    );
    const relativeFilePath = normalizePath(
      path.relative(options.rootDir, absolutePath)
    );
    const sourceFile = loadSourceFile(project, absolutePath);
    if (!sourceFile) {
      continue;
    }

    const body =
      loadBodyFromSourceFile(sourceFile, target.ownerLabel) ?? sourceFile;
    for (const site of analyzeStoreWritesInBody({
      body,
      filePath: relativeFilePath,
      ownerLabel: target.ownerLabel,
      storeField,
    })) {
      const key = `${site.filePath}:${site.loc?.startLine}:${site.expression}`;
      if (seenWriter.has(key)) {
        continue;
      }
      seenWriter.add(key);
      writers.push(site);
    }

    for (const site of analyzeStoreFieldEffectDeps({
      body,
      filePath: relativeFilePath,
      ownerLabel: target.ownerLabel,
      storeField,
    })) {
      const key = `${site.filePath}:${site.loc?.startLine}:trigger`;
      if (seenTrigger.has(key)) {
        continue;
      }
      seenTrigger.add(key);
      reactiveTriggers.push(site);
    }
  }

  writers.sort((a, b) => (a.loc?.startLine ?? 0) - (b.loc?.startLine ?? 0));
  reactiveTriggers.sort(
    (a, b) => (a.loc?.startLine ?? 0) - (b.loc?.startLine ?? 0)
  );

  return {
    pageScoped: true,
    reactiveTriggers,
    storeField,
    storeHook: options.storeHook,
    writers,
  };
};

export const storeFieldSetterLabel = (storeField: string): string =>
  setterNameForField(storeField);
