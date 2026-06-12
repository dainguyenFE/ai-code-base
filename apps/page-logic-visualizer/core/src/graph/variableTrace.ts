import { Project as TsMorphProject } from "ts-morph";
import type { Project, SourceFile } from "ts-morph";

import { findComponentByName } from "../analyzer/analyzeComponent";
import { analyzeHookUsages } from "../analyzer/hookTrace/analyzeHookUsage";
import type { HookUsage, PageLogicGraph } from "../types";
import {
  findTsConfigForFile,
  normalizePath,
  resolveFromRoot,
} from "../utils/path";

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
  filePath: string
): SourceFile | undefined =>
  project.getSourceFile(filePath) ??
  project.addSourceFileAtPathIfExists(filePath) ??
  undefined;

/** AST usages of a local variable inside a component body (render, hooks, calls). */
export const buildVariableUsages = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  variableName: string,
  options: { rootDir: string; tsConfigPath?: string; project?: Project }
): HookUsage[] => {
  const consumer = graph.nodes.find((node) => node.id === consumerNodeId);
  if (!consumer?.filePath) {
    return [];
  }

  const absolutePath = normalizePath(
    resolveFromRoot(options.rootDir, consumer.filePath)
  );

  const relativeFilePath = normalizePath(
    path.relative(
      options.rootDir,
      resolveFromRoot(options.rootDir, consumer.filePath)
    )
  );

  const project =
    options.project ??
    getProject(options.rootDir, consumer.filePath, options.tsConfigPath);

  const sourceFile = loadSourceFile(project, absolutePath);
  if (!sourceFile) {
    return [];
  }

  const component = findComponentByName(sourceFile, consumer.label);
  const body = component?.body ?? sourceFile;

  return analyzeHookUsages({
    accessPath: variableName,
    body,
    filePath: relativeFilePath,
    sourceFile,
  });
};
