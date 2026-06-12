import { existsSync } from "node:fs";
import path from "node:path";

import type { CallExpression, Project, SourceFile } from "ts-morph";
import { Project as TsMorphProject, SyntaxKind } from "ts-morph";

import { analyzeHookTraceFromSource } from "../analyzer/analyzeHookTrace";
import { resolveImport } from "../resolver/resolveImport";
import type {
  HookFlowStep,
  HookReturnFieldTrace,
  HookTraceView,
  LogicGraphNode,
  PageLogicGraph,
  UiLocalItem,
} from "../types";
import {
  graphNodeMatchesHookCallName,
  hookCallNameFromGraphNode,
} from "../utils/hookNodeNames";
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

const findContextProviderJsx = (
  sourceFile: SourceFile,
  filePath: string,
  contextName: string
):
  | {
      componentName: string;
      loc: SourceLocation;
      valueExpression: string;
    }
  | undefined => {
  const providerTag = `${contextName}.Provider`;
  let found:
    | {
        componentName: string;
        loc: SourceLocation;
        valueExpression: string;
      }
    | undefined;

  sourceFile.forEachDescendant((node) => {
    if (found) {
      return;
    }
    if (
      !node.isKind(SyntaxKind.JsxElement) &&
      !node.isKind(SyntaxKind.JsxSelfClosingElement)
    ) {
      return;
    }

    const tagName = getJsxTagName(node);
    if (tagName !== providerTag) {
      return;
    }

    const opening = node.isKind(SyntaxKind.JsxElement)
      ? node.getOpeningElement()
      : node;

    const valueAttr = opening
      .getAttributes()
      .find(
        (attr) =>
          attr.isKind(SyntaxKind.JsxAttribute) &&
          attr.getNameNode().getText() === "value"
      );
    const initializer =
      valueAttr?.isKind(SyntaxKind.JsxAttribute) &&
      valueAttr.getInitializer()?.isKind(SyntaxKind.JsxExpression)
        ? valueAttr.getInitializer()?.getExpression()
        : (valueAttr?.isKind(SyntaxKind.JsxAttribute)
          ? valueAttr.getInitializer()
          : undefined);

    if (!initializer) {
      return;
    }

    let componentName = sourceFile.getFunctions()[0]?.getName();
    let parent = node.getParent();
    while (parent) {
      if (parent.isKind(SyntaxKind.FunctionDeclaration) && parent.getName()) {
        componentName = parent.getName();
        break;
      }
      if (parent.isKind(SyntaxKind.VariableDeclaration)) {
        const init = parent.getInitializer();
        if (
          init?.isKind(SyntaxKind.ArrowFunction) ||
          init?.isKind(SyntaxKind.FunctionExpression)
        ) {
          const nameNode = parent.getNameNode();
          if (nameNode.isKind(SyntaxKind.Identifier)) {
            componentName = nameNode.getText();
            break;
          }
        }
      }
      parent = parent.getParent();
    }

    found = {
      componentName: componentName ?? "Provider",
      loc: getSourceLocation(opening, filePath),
      valueExpression: getNodeText(initializer),
    };
  });

  return found;
};

const appendContextProviderTraceSteps = ({
  consumerNodeId,
  contextName,
  filePath,
  focusedField,
  graph,
  imports,
  sourceFile,
  steps,
}: {
  consumerNodeId: string;
  contextName: string;
  filePath: string;
  focusedField?: string;
  graph: PageLogicGraph;
  imports: ReturnType<typeof analyzeImports>;
  sourceFile: SourceFile;
  steps: DataTraceStep[];
}): void => {
  const provider = findContextProviderJsx(sourceFile, filePath, contextName);
  if (!provider) {
    return;
  }

  steps.push({
    expression: provider.valueExpression,
    isUiNode: false,
    kind: "context",
    label: `${contextName}.Provider`,
    loc: provider.loc,
    nodeId: `${consumerNodeId}:context-provider:${contextName}`,
    stepRole: "variable",
    type: "context",
  });

  const hookBindings = collectComponentHookBindings(
    sourceFile,
    filePath,
    provider.componentName
  );
  const valueFields = parseObjectLiteralFieldNames(provider.valueExpression);
  const fieldsToTrace = focusedField
    ? valueFields.filter((field) => field === focusedField)
    : valueFields;

  for (const fieldName of fieldsToTrace) {
    const binding = hookBindings.get(fieldName);
    if (binding && isCustomHookName(binding.hookName)) {
      const hookNode = graph.nodes.find(
        (node) => node.type === "hook" && node.label === binding.hookName
      );
      const hookImport = imports.find((item) =>
        item.namedImports.includes(binding.hookName)
      );
      steps.push({
        definitionFilePath: hookNode?.filePath ?? hookImport?.resolvedPath,
        definitionSymbol: binding.hookName,
        expression: `${fieldName} = ${binding.hookName}(${binding.argumentExpression ?? ""})`,
        isUiNode: false,
        kind: "hook",
        label: binding.hookName,
        loc: binding.loc,
        nodeId: `${consumerNodeId}:provider-hook:${binding.hookName}:${fieldName}`,
        stepRole: "hook",
        type: "hook",
      });
      continue;
    }

    // Prop fields (e.g. context value `data`) can trace back to the same hook
    // and cause infinite nested trace expansion — only follow them when scoped.
    if (!focusedField) {
      continue;
    }

    const fieldSteps = buildSymbolTraceSteps(graph, fieldName, consumerNodeId);
    if (fieldSteps.length > 0) {
      steps.push(...fieldSteps);
    }
  }
};

const buildBuiltInParamTraceSteps = ({
  currentHookName,
  expression,
  focusedField,
  graph,
  hookNode,
  nestedTraceCache,
  project,
  rootDir,
  tsConfigPath,
  visited,
}: {
  currentHookName?: string;
  expression: string;
  focusedField?: string;
  graph: PageLogicGraph;
  hookNode: LogicGraphNode;
  nestedTraceCache?: NestedHookTraceCache;
  project: Project;
  rootDir: string;
  tsConfigPath?: string;
  visited?: Set<string>;
}): HookFlowStep[] => {
  const root = rootIdentifier(expression);
  const hookBindings = hookNode.metadata?.moduleBindings as
    | ModuleBindingMeta[]
    | undefined;

  let dataSteps = buildSymbolTraceSteps(graph, root, hookNode.id, {
    moduleBindings: hookBindings,
  });

  const definitionFilePath = resolveHookSourceFile(graph, hookNode, rootDir, {
    tsConfigPath,
  });

  if (
    dataSteps.length === 0 ||
    (dataSteps.length === 1 && !dataSteps[0]?.loc)
  ) {
    if (definitionFilePath) {
      const sourceFile = loadHookSourceFile(project, definitionFilePath);
      if (sourceFile) {
        const imports = analyzeImports({
          filePath: definitionFilePath,
          rootDir,
          sourceFile,
          tsConfigPath: tsConfigPath ?? "",
        });
        const bindings = analyzeModuleBindings({
          filePath: definitionFilePath,
          imports,
          project,
          rootDir,
          sourceFile,
          tsConfigPath,
        });
        dataSteps = buildSymbolTraceSteps(graph, root, hookNode.id, {
          moduleBindings: bindings,
        });

        const contextBinding = bindings.find((item) => item.name === root);
        if (contextBinding?.callFunctionName === "createContext") {
          appendContextProviderTraceSteps({
            consumerNodeId: hookNode.id,
            contextName: root,
            filePath: definitionFilePath,
            focusedField,
            graph,
            imports,
            sourceFile,
            steps: dataSteps,
          });
        }
      }
    }
  } else {
    const binding = hookBindings?.find((item) => item.name === root);
    if (binding?.callFunctionName === "createContext" && definitionFilePath) {
      const sourceFile = loadHookSourceFile(project, definitionFilePath);
      if (sourceFile) {
        const imports = analyzeImports({
          filePath: definitionFilePath,
          rootDir,
          sourceFile,
          tsConfigPath: tsConfigPath ?? "",
        });
        appendContextProviderTraceSteps({
          consumerNodeId: hookNode.id,
          contextName: root,
          filePath: definitionFilePath,
          focusedField,
          graph,
          imports,
          sourceFile,
          steps: dataSteps,
        });
      }
    }
  }

  const flowSteps = dataSteps.map(mapDataTraceStepToHookFlow);
  attachNestedTracesToFlowSteps({
    currentHookName,
    focusedReturnField: focusedField,
    graph,
    nestedTraceCache,
    parentDefinitionFilePath: definitionFilePath,
    project,
    rootDir,
    steps: flowSteps,
    tsConfigPath,
    visited,
  });
  return flowSteps;
};

const enrichBuiltInInternalHookParamTraces = ({
  currentHookName,
  focusedReturnField,
  graph,
  hookNode,
  nestedTraceCache,
  project,
  rootDir,
  trace,
  tsConfigPath,
  visited,
}: {
  currentHookName: string;
  focusedReturnField?: string;
  graph: PageLogicGraph;
  hookNode: LogicGraphNode;
  nestedTraceCache?: NestedHookTraceCache;
  project: Project;
  rootDir: string;
  trace: HookTraceView;
  tsConfigPath?: string;
  visited: Set<string>;
}): void => {
  if (!trace.internalHooks?.length) {
    return;
  }

  const enrichEntries = (entries: HookInternalEntry[]): void => {
    for (const entry of entries) {
      if (
        entry.kind === "builtin" &&
        entry.hookName &&
        isReactBuiltInHook(entry.hookName) &&
        entry.argumentExpression &&
        !entry.paramTraceSteps?.length
      ) {
        const paramSteps = buildBuiltInParamTraceSteps({
          currentHookName,
          expression: entry.argumentExpression,
          focusedField: focusedReturnField ?? entry.name,
          graph,
          hookNode,
          nestedTraceCache,
          project,
          rootDir,
          tsConfigPath,
          visited,
        });
        if (paramSteps.length > 0) {
          entry.paramTraceSteps = paramSteps;
        }
      }

      if (entry.children?.length) {
        enrichEntries(entry.children);
      }
    }
  };

  enrichEntries(trace.internalHooks);
};

const focusedReturnFieldFromStep = (step: HookFlowStep): string | undefined => {
  const match = step.expression.match(/^([a-zA-Z_$][\w$]*)\s*=\s*\w+\(/);
  return match?.[1];
};

const buildHookTraceFromDefinitionFile = ({
  focusedReturnField,
  filePath,
  graph,
  hookName,
  nestedTraceCache,
  project,
  rootDir,
  tsConfigPath,
  visited,
}: {
  focusedReturnField?: string;
  filePath: string;
  graph: PageLogicGraph;
  hookName: string;
  nestedTraceCache?: NestedHookTraceCache;
  project: Project;
  rootDir: string;
  tsConfigPath?: string;
  visited: Set<string>;
}): HookTraceView | undefined => {
  const cachedTrace = readCachedNestedHookTrace(hookName, nestedTraceCache);
  if (cachedTrace) {
    return cachedTrace;
  }

  if (visited.has(hookName)) {
    return undefined;
  }
  visited.add(hookName);

  const sourceFile = loadHookSourceFile(project, filePath);
  if (!sourceFile) {
    return undefined;
  }

  const hookNodeId = `definition:${filePath}:${hookName}`;
  const trace = analyzeHookTraceFromSource({
    filePath,
    hookName,
    hookNodeId,
    sourceFile,
  });
  if (!trace) {
    return undefined;
  }

  trace.definitionFilePath = filePath;
  trace.definitionSymbol = hookName;
  trace.focusedReturnField = focusedReturnField;
  if (focusedReturnField) {
    const field = trace.returnFields.find(
      (item) => item.name === focusedReturnField
    );
    trace.returnFields = field ? [field] : trace.returnFields;
    trace.traceScope = "return-field";
  }

  const imports = analyzeImports({
    filePath,
    rootDir,
    sourceFile,
    tsConfigPath: tsConfigPath ?? "",
  });
  const moduleBindings = analyzeModuleBindings({
    filePath,
    imports,
    project,
    rootDir,
    sourceFile,
    tsConfigPath,
  });
  const syntheticHookNode: LogicGraphNode = {
    filePath,
    id: hookNodeId,
    label: hookName,
    metadata: { moduleBindings },
    type: "hook",
  };

  for (const field of trace.returnFields) {
    enrichBuiltInParamTraces({
      currentHookName: hookName,
      focusedField: focusedReturnField,
      graph,
      hookNode: syntheticHookNode,
      nestedTraceCache,
      project,
      rootDir,
      steps: field.steps,
      tsConfigPath,
      visited,
    });
    attachNestedTraces({
      graph,
      nestedTraceCache,
      project,
      rootDir,
      steps: field.steps,
      trace,
      tsConfigPath,
      visited,
    });
  }

  enrichTraceWithInternalHooksFromSource({
    filePath,
    hookName,
    project,
    sourceFile,
    trace,
  });

  enrichBuiltInInternalHookParamTraces({
    currentHookName: hookName,
    focusedReturnField,
    graph,
    hookNode: syntheticHookNode,
    nestedTraceCache,
    project,
    rootDir,
    trace,
    tsConfigPath,
    visited,
  });

  attachNestedTracesToInternalHooks({
    currentHookName: hookName,
    graph,
    nestedTraceCache,
    project,
    rootDir,
    trace,
    tsConfigPath,
    visited,
  });

  return storeCachedNestedHookTrace(hookName, trace, nestedTraceCache);
};

const attachNestedTracesToFlowSteps = ({
  focusedReturnField,
  graph,
  project,
  rootDir,
  steps,
  tsConfigPath,
  visited,
}: {
  focusedReturnField?: string;
  graph: PageLogicGraph;
  project: Project;
  rootDir: string;
  steps: HookFlowStep[];
  tsConfigPath?: string;
  visited: Set<string>;
}): void => {
  for (const step of steps) {
    const nestedName = step.nestedHookName ?? step.hookName;
    if (
      nestedName &&
      isCustomHookName(nestedName) &&
      !visited.has(nestedName)
    ) {
      const nestedNode = graph.nodes.find(
        (node) => node.type === "hook" && node.label === nestedName
      );
      const nestedField =
        focusedReturnFieldFromStep(step) ?? focusedReturnField;
      const nestedTrace = nestedNode
        ? buildHookTraceView(graph, nestedNode.id, {
            focusedReturnField: nestedField,
            project,
            rootDir,
            traceScope: nestedField ? "return-field" : "full",
            tsConfigPath,
            visited: new Set(visited),
          })
        : (step.definitionFilePath
          ? buildHookTraceFromDefinitionFile({
              filePath: step.definitionFilePath,
              focusedReturnField: nestedField,
              graph,
              hookName: nestedName,
              project,
              rootDir,
              tsConfigPath,
              visited: new Set(visited),
            })
          : undefined);
      if (nestedTrace) {
        step.nestedTrace = nestedTrace;
      }
    }
    if (step.children?.length) {
      attachNestedTracesToFlowSteps({
        focusedReturnField,
        graph,
        project,
        rootDir,
        steps: step.children,
        tsConfigPath,
        visited,
      });
    }
  }
};

const enrichBuiltInParamTraces = ({
  currentHookName,
  focusedField,
  graph,
  hookNode,
  nestedTraceCache,
  project,
  rootDir,
  steps,
  tsConfigPath,
  visited,
}: {
  currentHookName?: string;
  focusedField?: string;
  graph: PageLogicGraph;
  hookNode: LogicGraphNode;
  nestedTraceCache?: NestedHookTraceCache;
  project: Project;
  rootDir: string;
  steps: HookFlowStep[];
  tsConfigPath?: string;
  visited?: Set<string>;
}): void => {
  for (const step of steps) {
    if (step.isBuiltIn && step.builtInParamExpression) {
      const paramSteps = buildBuiltInParamTraceSteps({
        currentHookName,
        expression: step.builtInParamExpression,
        focusedField,
        graph,
        hookNode,
        nestedTraceCache,
        project,
        rootDir,
        tsConfigPath,
        visited,
      });
      if (paramSteps.length > 0) {
        step.paramTraceSteps = paramSteps;
      }
    }
    if (step.children?.length) {
      enrichBuiltInParamTraces({
        currentHookName,
        focusedField,
        graph,
        hookNode,
        project,
        rootDir,
        steps: step.children,
        tsConfigPath,
        visited,
      });
    }
  }
};

const hookNameFromNode = hookCallNameFromGraphNode;

const parentHookNode = (
  graph: PageLogicGraph,
  hookNodeId: string
): LogicGraphNode | undefined => {
  const edge = graph.edges.find(
    (item) => item.target === hookNodeId && item.type === "uses-hook"
  );
  if (!edge) {
    return undefined;
  }
  return graph.nodes.find((node) => node.id === edge.source);
};

const tryResolveHookFile = (
  rootDir: string,
  hookName: string,
  parentFilePath: string,
  importPath?: string,
  tsConfigPath?: string
): string | undefined => {
  const absoluteParent = resolveFromRoot(rootDir, parentFilePath);

  if (importPath) {
    const resolved = resolveImport({
      currentFile: absoluteParent,
      moduleSpecifier: importPath,
      rootDir,
      tsConfigPath,
    }).resolvedPath;
    if (resolved && existsSync(resolved)) {
      return normalizePath(resolved);
    }
  }

  const parentDir = path.dirname(absoluteParent);
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

/** Resolve hook definition file when graph node filePath is missing or stale. */
export const resolveHookSourceFile = (
  graph: PageLogicGraph,
  node: LogicGraphNode,
  rootDir: string,
  options?: { tsConfigPath?: string }
): string | undefined => {
  const hookName = hookNameFromNode(node);
  if (!hookName) {
    return undefined;
  }

  const importPath =
    node.hook?.importPath ??
    node.store?.importPath ??
    node.context?.importPath ??
    node.importPath;
  const parent = parentHookNode(graph, node.id);

  if (node.type === "store" && importPath && parent?.filePath) {
    const fromImport = tryResolveHookFile(
      rootDir,
      hookName,
      parent.filePath,
      importPath,
      options?.tsConfigPath
    );
    if (fromImport) {
      return fromImport;
    }
  }

  if (node.filePath) {
    const normalized = normalizePath(resolveFromRoot(rootDir, node.filePath));
    if (
      normalized.endsWith(`/${hookName}.ts`) ||
      normalized.endsWith(`/${hookName}.tsx`) ||
      !parent?.filePath
    ) {
      return normalized;
    }
  }

  if (parent?.filePath) {
    const fromParent = tryResolveHookFile(
      rootDir,
      hookName,
      parent.filePath,
      importPath,
      options?.tsConfigPath
    );
    if (fromParent) {
      return fromParent;
    }
  }

  for (const candidate of graph.nodes) {
    if (
      (candidate.type !== "hook" && candidate.type !== "store") ||
      !graphNodeMatchesHookCallName(candidate, hookName)
    ) {
      continue;
    }
    if (!candidate.filePath) {
      continue;
    }
    const normalized = normalizePath(
      resolveFromRoot(rootDir, candidate.filePath)
    );
    if (
      normalized.endsWith(`/${hookName}.ts`) ||
      normalized.endsWith(`/${hookName}.tsx`)
    ) {
      return normalized;
    }
  }

  return node.filePath
    ? normalizePath(resolveFromRoot(rootDir, node.filePath))
    : undefined;
};

const loadHookSourceFile = (
  project: Project,
  filePath: string
): SourceFile | undefined =>
  project.getSourceFile(filePath) ??
  project.addSourceFileAtPathIfExists(filePath) ??
  undefined;

const nestedHookNameFromStep = (step: HookFlowStep): string | undefined =>
  step.nestedHookName ??
  (step.kind === "hook-call" ? step.hookName : undefined);

const attachNestedTraces = ({
  bindingVariable,
  graph,
  project,
  rootDir,
  steps,
  trace,
  tsConfigPath,
  visited,
}: {
  bindingVariable?: string;
  graph: PageLogicGraph;
  project: Project;
  rootDir: string;
  steps: HookFlowStep[];
  trace: HookTraceView;
  tsConfigPath?: string;
  visited: Set<string>;
}): void => {
  for (const step of steps) {
    const nestedName = nestedHookNameFromStep(step);
    if (
      !nestedName ||
      nestedName === trace.hookName ||
      visited.has(nestedName) ||
      isReactBuiltInHook(nestedName)
    ) {
      continue;
    }

    const nestedNode =
      graph.nodes.find(
        (node) =>
          node.type === "hook" &&
          node.label === nestedName &&
          graph.edges.some(
            (edge) =>
              edge.source === trace.hookNodeId &&
              edge.target === node.id &&
              edge.type === "uses-hook"
          )
      ) ??
      graph.nodes.find(
        (node) => node.type === "hook" && node.label === nestedName
      );

    const nestedField =
      bindingVariable ?? focusedReturnFieldFromStep(step) ?? undefined;
    const nestedTrace = nestedNode
      ? buildHookTraceView(graph, nestedNode.id, {
          bindingVariable:
            bindingVariable ??
            (step.kind === "hook-call" ? step.label : undefined),
          focusedReturnField: nestedField,
          project,
          rootDir,
          traceScope: nestedField ? "return-field" : "full",
          tsConfigPath,
          visited,
        })
      : (step.definitionFilePath
        ? buildHookTraceFromDefinitionFile({
            filePath: step.definitionFilePath,
            focusedReturnField: nestedField,
            graph,
            hookName: nestedName,
            project,
            rootDir,
            tsConfigPath,
            visited,
          })
        : buildNestedCustomHookTrace({
            currentHookName: trace.hookName,
            graph,
            hookName: nestedName,
            parentDefinitionFilePath: trace.definitionFilePath,
            project,
            rootDir,
            tsConfigPath,
            visited,
          }));
    if (nestedTrace) {
      if (nestedField && !nestedNode && !step.definitionFilePath) {
        nestedTrace.focusedReturnField = nestedField;
        nestedTrace.traceScope = "return-field";
      }
      step.nestedTrace = nestedTrace;
    }
  }
};

export const buildHookTraceView = (
  graph: PageLogicGraph,
  hookNodeId: string,
  options: {
    rootDir: string;
    tsConfigPath?: string;
    project?: Project;
    visited?: Set<string>;
    nestedTraceCache?: NestedHookTraceCache;
    bindingVariable?: string;
    consumerNodeId?: string;
    traceScope?: HookTraceScope;
    focusedReturnField?: string;
  }
): HookTraceView | undefined => {
  const node = graph.nodes.find((item) => item.id === hookNodeId);
  if (!node) {
    return undefined;
  }

  const hookName = hookNameFromNode(node);
  if (!hookName) {
    return undefined;
  }

  const nestedTraceCache =
    options.nestedTraceCache ?? new Map<string, HookTraceView>();
  const cachedTrace = readCachedNestedHookTrace(hookName, nestedTraceCache);
  if (cachedTrace) {
    return cachedTrace;
  }

  const filePath = resolveHookSourceFile(graph, node, options.rootDir, {
    tsConfigPath: options.tsConfigPath,
  });
  if (!filePath) {
    return undefined;
  }

  const visited = options.visited ?? new Set<string>();
  if (visited.has(hookName)) {
    return undefined;
  }
  visited.add(hookName);

  const project =
    options.project ??
    getProject(options.rootDir, filePath, options.tsConfigPath);

  const sourceFile = loadHookSourceFile(project, filePath);
  if (!sourceFile) {
    return undefined;
  }

  const trace = analyzeHookTraceFromSource({
    filePath,
    hookName,
    hookNodeId: node.id,
    sourceFile,
  });

  if (!trace) {
    return undefined;
  }

  trace.inputs = buildHookInputTraces({
    consumerNodeId: options.consumerNodeId,
    graph,
    hookName,
    hookNode: node,
    project,
    rootDir: options.rootDir,
    tsConfigPath: options.tsConfigPath,
  });
  trace.callExpression = node.hook?.callExpression;
  trace.callSiteLoc = node.loc;
  trace.traceScope = options.traceScope ?? "full";
  trace.focusedReturnField = options.focusedReturnField;
  if (isCustomHookName(hookName)) {
    trace.definitionFilePath = filePath;
    trace.definitionSymbol = hookName;
  }

  if (options.bindingVariable) {
    trace.bindingVariable = options.bindingVariable;
  }

  if (options.traceScope === "return-field" && options.focusedReturnField) {
    const field = trace.returnFields.find(
      (item) => item.name === options.focusedReturnField
    );
    trace.returnFields = field ? [field] : trace.returnFields;
  }

  for (const field of trace.returnFields) {
    enrichBuiltInParamTraces({
      currentHookName: hookName,
      focusedField: options.focusedReturnField,
      graph,
      hookNode: node,
      nestedTraceCache,
      project,
      rootDir: options.rootDir,
      steps: field.steps,
      tsConfigPath: options.tsConfigPath,
      visited,
    });
    attachNestedTraces({
      graph,
      nestedTraceCache,
      project,
      rootDir: options.rootDir,
      steps: field.steps,
      trace,
      tsConfigPath: options.tsConfigPath,
      visited,
    });
  }

  enrichTraceWithAssignment({
    bindingVariable: options.bindingVariable,
    consumerNodeId: options.consumerNodeId,
    focusedReturnField: options.focusedReturnField,
    graph,
    hookName,
    hookNodeId: node.id,
    project,
    rootDir: options.rootDir,
    trace,
    tsConfigPath: options.tsConfigPath,
  });

  enrichTraceWithInternalHooksFromSource({
    filePath,
    hookName,
    project,
    sourceFile,
    trace,
  });

  enrichBuiltInInternalHookParamTraces({
    currentHookName: hookName,
    focusedReturnField: options.focusedReturnField,
    graph,
    hookNode: node,
    nestedTraceCache,
    project,
    rootDir: options.rootDir,
    trace,
    tsConfigPath: options.tsConfigPath,
    visited,
  });

  attachNestedTracesToInternalHooks({
    currentHookName: hookName,
    graph,
    nestedTraceCache,
    project,
    rootDir: options.rootDir,
    trace,
    tsConfigPath: options.tsConfigPath,
    visited,
  });

  return storeCachedNestedHookTrace(hookName, trace, nestedTraceCache);
};

/** Resolve hook node id from a data-hook local item at a consumer component. */
export const resolveHookNodeIdForLocal = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  sourceHook: string
): string | undefined => {
  const edge = graph.edges.find((item) => {
    if (item.source !== consumerNodeId || item.type !== "uses-hook") {
      return false;
    }
    const target = graph.nodes.find((node) => node.id === item.target);
    return target ? graphNodeMatchesHookCallName(target, sourceHook) : false;
  });
  return edge?.target;
};

const findConsumerLocalItem = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  fieldName: string,
  sourceHook: string
): UiLocalItem | undefined => {
  const consumer = graph.nodes.find((node) => node.id === consumerNodeId);
  if (!consumer?.locals) {
    return undefined;
  }

  const buckets = [...consumer.locals.variables, ...consumer.locals.functions];

  return buckets.find(
    (item) => item.name === fieldName && item.sourceHook === sourceHook
  );
};

const enrichTraceWithAssignment = ({
  bindingVariable,
  consumerNodeId,
  focusedReturnField,
  graph,
  hookName,
  hookNodeId,
  project,
  rootDir,
  trace,
  tsConfigPath,
}: {
  bindingVariable?: string;
  consumerNodeId?: string;
  focusedReturnField?: string;
  graph: PageLogicGraph;
  hookName: string;
  hookNodeId: string;
  project: Project;
  rootDir: string;
  trace: HookTraceView;
  tsConfigPath?: string;
}): void => {
  const consumerId = resolveConsumerForHook(graph, hookNodeId, consumerNodeId);
  const consumer = consumerId
    ? graph.nodes.find((node) => node.id === consumerId)
    : undefined;
  const consumerFilePath = consumer?.filePath
    ? normalizePath(resolveFromRoot(rootDir, consumer.filePath))
    : trace.definitionFilePath;

  if (!consumerFilePath || !trace.definitionFilePath) {
    return;
  }

  const consumerSource = loadHookSourceFile(project, consumerFilePath);
  if (!consumerSource) {
    return;
  }

  const assignments = detectHookAssignments(consumerSource, consumerFilePath);
  const assignment =
    assignments.find(
      (item) =>
        item.hookName === hookName &&
        (!bindingVariable || item.variableName === bindingVariable)
    ) ?? assignments.find((item) => item.hookName === hookName);

  if (!assignment) {
    return;
  }

  const consumerComponent = consumer
    ? findComponentByName(consumerSource, consumer.label)
    : undefined;

  const assignmentTrace = analyzeHookAssignmentFromFiles({
    assignment,
    consumerBody: consumerComponent?.body ?? consumerSource,
    consumerFilePath,
    hookDefinitionFile: trace.definitionFilePath,
    hookNodeId,
    project,
    projectRoot: rootDir,
    propertyPath: focusedReturnField,
  });

  if (!assignmentTrace) {
    return;
  }

  trace.assignment = assignmentTrace;
  trace.target = assignmentTrace.target;
  trace.graph = assignmentTrace.graph;
  trace.returnLineage = assignmentTrace.returnLineage;
  trace.usages = assignmentTrace.usages;
  trace.warnings = assignmentTrace.warnings;
  trace.internalHooks = assignmentTrace.internalHooks;
};

const enrichTraceWithInternalHooksFromSource = ({
  filePath,
  hookName,
  project,
  sourceFile,
  trace,
}: {
  filePath: string;
  hookName: string;
  project: Project;
  sourceFile: SourceFile;
  trace: HookTraceView;
}): void => {
  if (trace.internalHooks && trace.internalHooks.length > 0) {
    return;
  }

  const component = findComponentByName(sourceFile, hookName);
  if (!component?.body?.isKind(SyntaxKind.Block)) {
    return;
  }

  const bodyAnalysis = analyzeHookBodyVariables(component.body, filePath);
  trace.internalHooks = buildInternalHookTree({ bodyAnalysis, hookName });
};

const traceDefinitionFilePath = (
  graph: PageLogicGraph,
  hookName: string,
  rootDir: string,
  tsConfigPath?: string
): string | undefined => {
  const hookNode = graph.nodes.find(
    (node) =>
      (node.type === "hook" ||
        node.type === "store" ||
        node.type === "context") &&
      graphNodeMatchesHookCallName(node, hookName)
  );
  if (!hookNode) {
    return undefined;
  }
  return resolveHookSourceFile(graph, hookNode, rootDir, { tsConfigPath });
};

const resolveCustomHookDefinitionFile = ({
  graph,
  hookName,
  parentDefinitionFilePath,
  project,
  rootDir,
  tsConfigPath,
}: {
  graph: PageLogicGraph;
  hookName: string;
  parentDefinitionFilePath?: string;
  project: Project;
  rootDir: string;
  tsConfigPath?: string;
}): string | undefined => {
  const fromGraphNode = traceDefinitionFilePath(
    graph,
    hookName,
    rootDir,
    tsConfigPath
  );
  if (fromGraphNode) {
    return fromGraphNode;
  }

  for (const node of graph.nodes) {
    if (!node.filePath || !graphNodeMatchesHookCallName(node, hookName)) {
      continue;
    }
    const normalized = node.filePath.replaceAll("\\", "/");
    if (
      normalized.endsWith(`/${hookName}.ts`) ||
      normalized.endsWith(`/${hookName}.tsx`)
    ) {
      return normalizePath(resolveFromRoot(rootDir, node.filePath));
    }
  }

  if (!parentDefinitionFilePath) {
    return undefined;
  }

  const parentFile = path.isAbsolute(parentDefinitionFilePath)
    ? parentDefinitionFilePath
    : normalizePath(resolveFromRoot(rootDir, parentDefinitionFilePath));

  const sourceFile = loadHookSourceFile(project, parentFile);
  if (sourceFile) {
    const imports = analyzeImports({
      filePath: parentFile,
      rootDir,
      sourceFile,
      tsConfigPath: tsConfigPath ?? "",
    });

    for (const imp of imports) {
      if (imp.isTypeOnly) {
        continue;
      }
      const importsHook =
        imp.defaultImport === hookName || imp.namedImports.includes(hookName);
      if (!importsHook) {
        continue;
      }

      if (imp.resolvedPath && existsSync(imp.resolvedPath)) {
        const resolved = normalizePath(imp.resolvedPath);
        if (resolved.endsWith(".ts") || resolved.endsWith(".tsx")) {
          return resolved;
        }
      }

      const fromImport = resolveHookDefinitionFile({
        currentFile: parentFile,
        hookName,
        importPath: imp.moduleSpecifier,
        projectRoot: rootDir,
        tsConfigPath,
      });
      if (fromImport) {
        return fromImport;
      }
    }
  }

  return resolveHookDefinitionFile({
    currentFile: parentFile,
    hookName,
    projectRoot: rootDir,
    tsConfigPath,
  });
};

const buildNestedCustomHookTrace = ({
  currentHookName,
  graph,
  hookName,
  nestedTraceCache,
  parentDefinitionFilePath,
  project,
  rootDir,
  tsConfigPath,
  visited,
}: {
  currentHookName: string;
  graph: PageLogicGraph;
  hookName: string;
  nestedTraceCache?: NestedHookTraceCache;
  parentDefinitionFilePath?: string;
  project: Project;
  rootDir: string;
  tsConfigPath?: string;
  visited: Set<string>;
}): HookTraceView | undefined => {
  if (!isCustomHookName(hookName) || hookName === currentHookName) {
    return undefined;
  }

  const cachedTrace = readCachedNestedHookTrace(hookName, nestedTraceCache);
  if (cachedTrace) {
    return cachedTrace;
  }

  const nestedNode = graph.nodes.find(
    (node) =>
      (node.type === "hook" ||
        node.type === "store" ||
        node.type === "context") &&
      graphNodeMatchesHookCallName(node, hookName)
  );

  if (nestedNode) {
    return buildHookTraceView(graph, nestedNode.id, {
      nestedTraceCache,
      project,
      rootDir,
      traceScope: "full",
      tsConfigPath,
      visited,
    });
  }

  const definitionFile = resolveCustomHookDefinitionFile({
    graph,
    hookName,
    parentDefinitionFilePath,
    project,
    rootDir,
    tsConfigPath,
  });

  if (!definitionFile) {
    return undefined;
  }

  return buildHookTraceFromDefinitionFile({
    filePath: definitionFile,
    graph,
    hookName,
    nestedTraceCache,
    project,
    rootDir,
    tsConfigPath,
    visited,
  });
};

const attachNestedTracesToInternalEntries = ({
  currentHookName,
  entries,
  graph,
  nestedTraceCache,
  parentDefinitionFilePath,
  project,
  rootDir,
  tsConfigPath,
  visited,
}: {
  currentHookName: string;
  entries: HookInternalEntry[];
  graph: PageLogicGraph;
  nestedTraceCache?: NestedHookTraceCache;
  parentDefinitionFilePath?: string;
  project: Project;
  rootDir: string;
  tsConfigPath?: string;
  visited: Set<string>;
}): void => {
  for (const entry of entries) {
    if (entry.kind === "return") {
      continue;
    }

    const nestedName = entry.hookName;
    if (nestedName && isCustomHookName(nestedName) && !entry.nestedTrace) {
      const nestedTrace = buildNestedCustomHookTrace({
        currentHookName,
        graph,
        hookName: nestedName,
        nestedTraceCache,
        parentDefinitionFilePath,
        project,
        rootDir,
        tsConfigPath,
        visited,
      });
      if (nestedTrace) {
        entry.nestedTrace = nestedTrace;
      }
    }

    if (entry.children?.length) {
      attachNestedTracesToInternalEntries({
        currentHookName,
        entries: entry.children,
        graph,
        nestedTraceCache,
        parentDefinitionFilePath,
        project,
        rootDir,
        tsConfigPath,
        visited,
      });
    }
  }
};

const attachNestedTracesToInternalHooks = ({
  currentHookName,
  graph,
  nestedTraceCache,
  parentDefinitionFilePath,
  project,
  rootDir,
  trace,
  tsConfigPath,
  visited = new Set<string>(),
}: {
  currentHookName: string;
  graph: PageLogicGraph;
  nestedTraceCache?: NestedHookTraceCache;
  parentDefinitionFilePath?: string;
  project: Project;
  rootDir: string;
  trace: HookTraceView;
  tsConfigPath?: string;
  visited?: Set<string>;
}): void => {
  if (!trace.internalHooks?.length) {
    return;
  }

  attachNestedTracesToInternalEntries({
    currentHookName,
    entries: trace.internalHooks,
    graph,
    nestedTraceCache,
    parentDefinitionFilePath:
      parentDefinitionFilePath ?? trace.definitionFilePath,
    project,
    rootDir,
    tsConfigPath,
    visited,
  });
};

const prependConsumerAssignStep = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  sourceHook: string,
  field: HookReturnFieldTrace
): HookReturnFieldTrace => {
  const localItem = findConsumerLocalItem(
    graph,
    consumerNodeId,
    field.name,
    sourceHook
  );
  if (!localItem) {
    return field;
  }

  return {
    ...field,
    steps: [
      {
        expression:
          localItem.expression ?? `{ ${field.name} } = ${sourceHook}(...)`,
        kind: "consumer-assign",
        label: field.name,
        loc: localItem.loc,
      },
      ...field.steps,
    ],
  };
};

/** Hook trace scoped to one effect call in a component/hook body. */
export const buildHookTraceFromEffectLocal = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  effectHookName: string,
  options: { rootDir: string; tsConfigPath?: string; project?: Project }
): HookTraceView | undefined => {
  const consumer = graph.nodes.find((node) => node.id === consumerNodeId);
  if (!consumer?.filePath) {
    return undefined;
  }

  const project =
    options.project ??
    getProject(options.rootDir, consumer.filePath, options.tsConfigPath);

  const sourceFile = loadHookSourceFile(project, consumer.filePath);
  if (!sourceFile) {
    return undefined;
  }

  const trace = analyzeHookTraceFromSource({
    filePath: consumer.filePath,
    hookName: consumer.label,
    hookNodeId: consumerNodeId,
    sourceFile,
  });

  if (!trace) {
    return undefined;
  }

  return {
    ...trace,
    effects: trace.effects.filter(
      (effect) => effect.hookName === effectHookName
    ),
    inputs: [],
    returnFields: [],
    traceScope: "full",
  };
};

/** Trace return field flow inside an expanded hook (by hook node id). */
export const buildHookTraceForReturnField = (
  graph: PageLogicGraph,
  hookNodeId: string,
  fieldName: string,
  options: { rootDir: string; tsConfigPath?: string; project?: Project }
): HookReturnFieldTrace | undefined => {
  const trace = buildHookTraceView(graph, hookNodeId, options);
  return trace?.returnFields.find((field) => field.name === fieldName);
};

/** Trace a custom hook invoked at a component, optionally focused on one return field. */
export const buildHookTraceFromDataLocal = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  sourceHook: string,
  options: {
    rootDir: string;
    tsConfigPath?: string;
    project?: Project;
    fieldName?: string;
  }
): HookTraceView | undefined => {
  const hookNodeId = resolveHookNodeIdForLocal(
    graph,
    consumerNodeId,
    sourceHook
  );
  if (!hookNodeId) {
    return undefined;
  }

  const trace = buildHookTraceView(graph, hookNodeId, options);
  if (!trace) {
    return undefined;
  }

  let { returnFields } = trace;
  if (options.fieldName) {
    const field = trace.returnFields.find(
      (item) => item.name === options.fieldName
    );
    returnFields = field ? [field] : returnFields;
  }

  returnFields = returnFields.map((field) =>
    prependConsumerAssignStep(graph, consumerNodeId, sourceHook, field)
  );

  return {
    ...trace,
    returnFields,
  };
};
