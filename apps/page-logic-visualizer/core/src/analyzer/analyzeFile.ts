import { existsSync } from "node:fs";
import path from "node:path";

import type { Project } from "ts-morph";
import { Project as TsMorphProject } from "ts-morph";

import { mergeAnalyzerConfig } from "../config";
import { GraphBuilder, createNodeId } from "../graph/createGraph";
import type {
  AnalyzePageFileOptions,
  LogicGraphNode,
  PageLogicGraph,
} from "../types";
import type { AnalyzeComponentInFileOptions } from "../types";
import {
  detectAppDir,
  findTsConfigForFile,
  normalizePath,
  resolveFromRoot,
} from "../utils/path";
import { findComponentByName, findMainComponent } from "./analyzeComponent";
import { analyzeFunctionBody } from "./analyzeFunctionBody";
import { analyzeImports } from "./analyzeImports";
import { analyzeModuleBindings } from "./analyzeModuleBindings";

const projectCache = new Map<string, Project>();

const getOrCreateProject = (tsConfigPath: string): Project => {
  const cached = projectCache.get(tsConfigPath);
  if (cached) {
    return cached;
  }

  const project = new TsMorphProject({
    skipAddingFilesFromTsConfig: true,
    tsConfigFilePath: tsConfigPath,
  });
  projectCache.set(tsConfigPath, project);
  return project;
};

export const analyzePageFile = (
  options: AnalyzePageFileOptions
): PageLogicGraph => {
  const rootDir = options.rootDir ?? process.cwd();
  const config = mergeAnalyzerConfig({
    ignoreComponents: options.ignoreComponents,
    includeHtmlElements: options.includeHtmlElements,
    includeHtmlTags: options.includeHtmlTags,
    maxDepth: options.maxDepth,
  });

  const entryFile = resolveFromRoot(rootDir, options.entryFile);
  if (!existsSync(entryFile)) {
    const graph = new GraphBuilder();
    graph.addWarning({
      code: "FILE_NOT_FOUND",
      filePath: options.entryFile,
      message: `Entry file not found: ${options.entryFile}`,
    });
    return graph.toGraph("missing", options.entryFile);
  }

  const tsConfigPath =
    options.tsConfigPath ?? findTsConfigForFile(rootDir, entryFile);

  if (!tsConfigPath) {
    const graph = new GraphBuilder();
    graph.addWarning({
      code: "TS_CONFIG_PATH_NOT_FOUND",
      filePath: entryFile,
      message: "Could not find tsconfig.json for entry file",
    });
    return graph.toGraph("missing", entryFile);
  }

  const project = getOrCreateProject(tsConfigPath);
  let sourceFile = project.getSourceFile(entryFile);
  if (!sourceFile) {
    sourceFile = project.addSourceFileAtPath(entryFile);
  }

  const graph = new GraphBuilder();
  const imports = analyzeImports({
    filePath: entryFile,
    rootDir,
    sourceFile,
    tsConfigPath,
  });

  const component = findMainComponent(sourceFile);
  if (!component) {
    graph.addWarning({
      code: "NO_DEFAULT_EXPORT_FOUND",
      filePath: entryFile,
      message: "No default export page component found",
    });
    return graph.toGraph("missing", entryFile);
  }

  const pageNode: LogicGraphNode = {
    exportName: component.name,
    filePath: entryFile,
    id: createNodeId({
      filePath: entryFile,
      name: component.name,
      type: "page",
    }),
    label: component.name,
    metadata: {
      moduleBindings: analyzeModuleBindings({
        filePath: entryFile,
        imports,
        project,
        rootDir,
        sourceFile,
        tsConfigPath,
      }),
    },
    type: "page",
  };

  graph.addNode(pageNode);
  graph.trackFile({
    filePath: entryFile,
    importCount: imports.length,
    isLayout: entryFile.endsWith("layout.tsx"),
    isPage: entryFile.endsWith("page.tsx"),
  });

  for (const importInfo of imports) {
    if (!importInfo.resolvedPath) {
      graph.addWarning({
        code: "UNRESOLVED_IMPORT",
        filePath: entryFile,
        message: `Could not resolve import ${importInfo.moduleSpecifier}`,
      });
      continue;
    }

    graph.trackFile({
      filePath: importInfo.resolvedPath,
      importCount: 0,
      isLayout: importInfo.resolvedPath.endsWith("layout.tsx"),
      isPage: importInfo.resolvedPath.endsWith("page.tsx"),
    });
  }

  analyzeFunctionBody({
    body: component.body,
    ctx: {
      config,
      filePath: entryFile,
      graph,
      imports,
      parentNode: pageNode,
      project,
      rootDir,
      tsConfigPath,
    },
  });

  return graph.toGraph(
    pageNode.id,
    normalizePath(path.relative(rootDir, entryFile))
  );
};

export const analyzeComponentInFile = (
  options: AnalyzeComponentInFileOptions
): PageLogicGraph => {
  const rootDir = options.rootDir ?? process.cwd();
  const config = mergeAnalyzerConfig({
    ignoreComponents: options.ignoreComponents,
    includeHtmlElements: options.includeHtmlElements,
    includeHtmlTags: options.includeHtmlTags,
    maxDepth: options.maxDepth,
  });

  const entryFile = resolveFromRoot(rootDir, options.entryFile);
  if (!existsSync(entryFile)) {
    const graph = new GraphBuilder();
    graph.addWarning({
      code: "FILE_NOT_FOUND",
      filePath: options.entryFile,
      message: `Entry file not found: ${options.entryFile}`,
    });
    return graph.toGraph("missing", options.entryFile);
  }

  const tsConfigPath =
    options.tsConfigPath ?? findTsConfigForFile(rootDir, entryFile);

  if (!tsConfigPath) {
    const graph = new GraphBuilder();
    graph.addWarning({
      code: "TS_CONFIG_PATH_NOT_FOUND",
      filePath: entryFile,
      message: "Could not find tsconfig.json for entry file",
    });
    return graph.toGraph("missing", entryFile);
  }

  const project = getOrCreateProject(tsConfigPath);
  let sourceFile = project.getSourceFile(entryFile);
  if (!sourceFile) {
    sourceFile = project.addSourceFileAtPath(entryFile);
  }

  const graph = new GraphBuilder();
  const imports = analyzeImports({
    filePath: entryFile,
    rootDir,
    sourceFile,
    tsConfigPath,
  });

  const component = findComponentByName(sourceFile, options.componentName);
  if (!component) {
    graph.addWarning({
      code: "COMPONENT_NOT_FOUND",
      filePath: entryFile,
      message: `Component not found: ${options.componentName}`,
    });
    return graph.toGraph("missing", entryFile);
  }

  const componentNode: LogicGraphNode = {
    exportName: component.name,
    filePath: entryFile,
    id: createNodeId({
      filePath: entryFile,
      name: component.name,
      type: "component",
    }),
    label: component.name,
    metadata: {
      moduleBindings: analyzeModuleBindings({
        filePath: entryFile,
        imports,
        project,
        rootDir,
        sourceFile,
        tsConfigPath,
      }),
    },
    type: "component",
  };

  graph.addNode(componentNode);
  graph.trackFile({
    filePath: entryFile,
    importCount: imports.length,
    isLayout: entryFile.endsWith("layout.tsx"),
    isPage: entryFile.endsWith("page.tsx"),
  });

  for (const importInfo of imports) {
    if (!importInfo.resolvedPath) {
      graph.addWarning({
        code: "UNRESOLVED_IMPORT",
        filePath: entryFile,
        message: `Could not resolve import ${importInfo.moduleSpecifier}`,
      });
      continue;
    }

    graph.trackFile({
      filePath: importInfo.resolvedPath,
      importCount: 0,
      isLayout: importInfo.resolvedPath.endsWith("layout.tsx"),
      isPage: importInfo.resolvedPath.endsWith("page.tsx"),
    });
  }

  analyzeFunctionBody({
    body: component.body,
    ctx: {
      config,
      filePath: entryFile,
      graph,
      imports,
      parentNode: componentNode,
      project,
      rootDir,
      tsConfigPath,
    },
  });

  return graph.toGraph(
    componentNode.id,
    normalizePath(path.relative(rootDir, entryFile))
  );
};
