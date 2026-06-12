import { existsSync } from "node:fs";
import path from "node:path";

import type { Block, Project, SourceFile } from "ts-morph";
import { Project as TsMorphProject, SyntaxKind } from "ts-morph";

import { resolveImport } from "../../resolver/resolveImport";
import type {
  HookAssignmentTrace,
  HookTraceView,
  TraceTarget,
  TraceWarning,
} from "../../types";
import { normalizePath, resolveFromRoot } from "../../utils/path";
import { findComponentByName } from "../analyzeComponent";
import { analyzeAllHookUsages } from "./analyzeHookUsage";
import {
  buildHookTraceGraphData,
  lineageToFlowSteps,
} from "./buildHookTraceGraph";
import { analyzeHookBodyVariables, detectHookAssignments } from "./shared";
import type { HookAssignmentBinding } from "./shared";

export interface AnalyzeHookAssignmentOptions {
  projectRoot: string;
  filePath: string;
  variableName?: string;
  hookName?: string;
  propertyPath?: string;
  tsConfigPath?: string;
  hookNodeId?: string;
  consumerFilePath?: string;
  consumerBody?: import("ts-morph").Node;
}

const loadSourceFile = (
  project: Project,
  filePath: string
): SourceFile | undefined =>
  project.getSourceFile(filePath) ??
  project.addSourceFileAtPathIfExists(filePath) ??
  undefined;

export const resolveHookDefinitionFile = ({
  currentFile,
  hookName,
  importPath,
  projectRoot,
  tsConfigPath,
}: {
  currentFile: string;
  hookName: string;
  importPath?: string;
  projectRoot: string;
  tsConfigPath?: string;
}): string | undefined => {
  if (importPath) {
    const resolved = resolveImport({
      currentFile,
      moduleSpecifier: importPath,
      rootDir: projectRoot,
      tsConfigPath,
    }).resolvedPath;
    if (resolved && existsSync(resolved)) {
      return normalizePath(resolved);
    }
  }

  const parentDir = path.dirname(currentFile);
  const candidates = [
    path.join(parentDir, `${hookName}.ts`),
    path.join(parentDir, `${hookName}.tsx`),
    path.join(parentDir, "hooks", `${hookName}.ts`),
    path.join(parentDir, "hooks", `${hookName}.tsx`),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return normalizePath(candidate);
    }
  }

  return undefined;
};

const findHookBody = (
  sourceFile: SourceFile,
  hookName: string
): Block | undefined => {
  const component = findComponentByName(sourceFile, hookName);
  return component?.body?.isKind(SyntaxKind.Block) ? component.body : undefined;
};

const buildTarget = (
  assignment: HookAssignmentBinding,
  propertyPath?: string
): TraceTarget => ({
  file: assignment.loc?.filePath ?? "",
  kind: propertyPath ? "property" : "variable",
  line: assignment.loc?.startLine,
  name: assignment.variableName,
  propertyPath,
});

export const analyzeHookAssignmentFromFiles = ({
  assignment,
  consumerBody,
  consumerFilePath,
  hookDefinitionFile,
  hookNodeId,
  project,
  projectRoot,
  propertyPath,
}: {
  assignment: HookAssignmentBinding;
  consumerBody?: import("ts-morph").Node;
  consumerFilePath: string;
  hookDefinitionFile: string;
  hookNodeId: string;
  project: Project;
  projectRoot: string;
  propertyPath?: string;
}): HookAssignmentTrace | undefined => {
  const hookSource = loadSourceFile(project, hookDefinitionFile);
  if (!hookSource) {
    return undefined;
  }

  const body = findHookBody(hookSource, assignment.hookName);
  if (!body) {
    return undefined;
  }

  const warnings: TraceWarning[] = [];
  const bodyAnalysis = analyzeHookBodyVariables(body, hookDefinitionFile);

  if (bodyAnalysis.returnFields.length === 0) {
    warnings.push({
      file: hookDefinitionFile,
      level: "warning",
      message: "No return object detected — lineage may be incomplete",
    });
  }

  const graphData = buildHookTraceGraphData({
    assignment,
    bindingVariable: assignment.variableName,
    bodyAnalysis,
    hookDefinitionFile,
    hookName: assignment.hookName,
    warnings,
  });

  const consumerSource = loadSourceFile(project, consumerFilePath);
  let usages = graphData.returnLineage.map((lineage) => ({
    file: consumerFilePath,
    kind: "jsx-prop" as const,
    label: `${lineage.callerAccessPath} (not used)`,
  }));

  if (consumerBody && consumerSource) {
    usages = analyzeAllHookUsages({
      bindingVariable: assignment.variableName,
      body: consumerBody,
      filePath: consumerFilePath,
      returnFieldNames: bodyAnalysis.returnFields.map((field) => field.name),
      sourceFile: consumerSource,
    });
  }

  if (propertyPath) {
    const filteredLineage = graphData.returnLineage.filter(
      (lineage) => lineage.returnedName === propertyPath
    );
    const filteredUsages = usages.filter((usage) =>
      usage.label.includes(`${assignment.variableName}.${propertyPath}`)
    );
    return {
      graph: graphData.graph,
      hook: graphData.hookNode,
      internalHooks: graphData.internalHooks,
      returnLineage: filteredLineage,
      target: buildTarget(assignment, propertyPath),
      usages: filteredUsages,
      warnings: graphData.warnings,
    };
  }

  return {
    graph: graphData.graph,
    hook: { ...graphData.hookNode, meta: { hookNodeId } },
    internalHooks: graphData.internalHooks,
    returnLineage: graphData.returnLineage,
    target: buildTarget(assignment),
    usages,
    warnings: graphData.warnings,
  };
};

export const analyzeHookAssignment = async (
  options: AnalyzeHookAssignmentOptions
): Promise<HookAssignmentTrace | undefined> => {
  const absoluteFile = normalizePath(
    resolveFromRoot(options.projectRoot, options.filePath)
  );
  const tsConfigPath =
    options.tsConfigPath ?? `${options.projectRoot}/tsconfig.json`;

  const project = new TsMorphProject({
    skipAddingFilesFromTsConfig: true,
    tsConfigFilePath: tsConfigPath,
  });

  const consumerSource = loadSourceFile(project, absoluteFile);
  if (!consumerSource) {
    return undefined;
  }

  const assignments = detectHookAssignments(
    consumerSource,
    absoluteFile,
    options.variableName
  );

  const assignment =
    assignments.find((item) =>
      options.hookName ? item.hookName === options.hookName : true
    ) ?? assignments[0];

  if (!assignment) {
    return undefined;
  }

  const hookDefinitionFile = resolveHookDefinitionFile({
    currentFile: absoluteFile,
    hookName: assignment.hookName,
    projectRoot: options.projectRoot,
    tsConfigPath,
  });

  if (!hookDefinitionFile) {
    return undefined;
  }

  const consumerBody =
    options.consumerBody ??
    findComponentByName(
      consumerSource,
      path.basename(absoluteFile, path.extname(absoluteFile))
    )?.body;

  return analyzeHookAssignmentFromFiles({
    assignment,
    consumerBody: consumerBody ?? consumerSource,
    consumerFilePath: absoluteFile,
    hookDefinitionFile,
    hookNodeId: options.hookNodeId ?? `hook:${assignment.hookName}`,
    project,
    projectRoot: options.projectRoot,
    propertyPath: options.propertyPath,
  });
};

export const assignmentToHookTraceView = ({
  assignment,
  bindingVariable,
  callExpression,
  callSiteLoc,
  definitionFilePath,
  definitionSymbol,
  focusedReturnField,
  hookName,
  hookNodeId,
  traceScope,
}: {
  assignment: HookAssignmentTrace;
  bindingVariable?: string;
  callExpression?: string;
  callSiteLoc?: import("../../types").SourceLocation;
  definitionFilePath?: string;
  definitionSymbol?: string;
  focusedReturnField?: string;
  hookName: string;
  hookNodeId: string;
  traceScope: import("../../types").HookTraceScope;
}): HookTraceView => {
  const bodyAnalysis = {
    nestedHookNames: assignment.internalHooks
      .map((entry) => entry.hookName)
      .filter((name): name is string => Boolean(name)),
    returnFields: assignment.returnLineage.map((lineage) => ({
      expression: lineage.returnedName,
      name: lineage.returnedName,
    })),
    variables: assignment.internalHooks
      .filter((entry) => entry.kind !== "return")
      .map((entry) => ({
        argumentExpression: undefined,
        dependencies: entry.dependencies ?? [],
        expression: entry.expression ?? entry.name,
        hookName: entry.hookName,
        kind: (entry.kind === "hook"
          ? "hook"
          : (entry.kind === "builtin"
            ? "builtin"
            : "derived")) as "hook" | "builtin" | "derived",
        loc: entry.loc,
        name: entry.name,
      })),
  };

  const flowSteps = lineageToFlowSteps({
    bindingVariable: bindingVariable ?? assignment.target.name,
    bodyAnalysis: bodyAnalysis as Parameters<
      typeof lineageToFlowSteps
    >[0]["bodyAnalysis"],
    focusedField: focusedReturnField,
  });

  let returnFields = [...flowSteps.entries()].map(([name, steps]) => ({
    name,
    steps,
  }));

  if (focusedReturnField) {
    returnFields = returnFields.filter(
      (field) => field.name === focusedReturnField
    );
  }

  return {
    assignment,
    bindingVariable,
    callExpression,
    callSiteLoc,
    definitionFilePath,
    definitionSymbol,
    effects: [],
    focusedReturnField,
    graph: assignment.graph,
    hookName,
    hookNodeId,
    inputs: [],
    internalHooks: assignment.internalHooks,
    returnFields,
    returnLineage: assignment.returnLineage,
    target: assignment.target,
    traceScope,
    usages: assignment.usages,
    warnings: assignment.warnings,
  };
};
