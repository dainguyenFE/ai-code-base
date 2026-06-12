import { existsSync } from "node:fs";

import type {
  CallExpression,
  JsxElement,
  JsxSelfClosingElement,
  Node,
  SourceFile,
} from "ts-morph";
import { Project, SyntaxKind } from "ts-morph";

import type {
  ImportInfo,
  LayoutDataSourceTrace,
  LayoutDependencyTrace,
  LayoutDiagnostic,
  LayoutGuardTrace,
  LayoutMetadataTrace,
  LayoutPropTrace,
  LayoutProviderTrace,
  LayoutRenderTrace,
  LayoutSegmentConfigTrace,
  LayoutSlotTrace,
  LayoutTrace,
  PageLogicGraph,
  RouteChainEntry,
} from "../types";
import {
  collectAwaitCalls,
  getJsxChildren,
  getJsxTagName,
  getNodeText,
  getSourceLocation,
  isJsxStructure,
  unwrapExpression,
} from "../utils/ast";
import {
  isHtmlElement,
  isReactComponentTag,
  normalizePath,
  resolveFromRoot,
} from "../utils/path";
import { findTsConfigForFile } from "../utils/path";
import { findMainComponent } from "./analyzeComponent";
import { analyzeImports } from "./analyzeImports";
import { analyzeJsxProps } from "./analyzeJsx";

export interface AnalyzeLayoutTraceOptions {
  entryFile: string;
  rootDir?: string;
  tsConfigPath?: string;
  route?: string;
  childrenTarget?: string;
  childrenTargetKind?: "layout" | "page";
}

const GUARD_CALLEES = new Set([
  "redirect",
  "permanentRedirect",
  "notFound",
  "unauthorized",
  "forbidden",
]);

const SEGMENT_CONFIG_EXPORTS = [
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
] as const;

const isProviderName = (name: string): boolean =>
  /Provider$/i.test(name) || name.includes("Provider");

const classifyRender = (name: string): LayoutRenderTrace["classification"] => {
  if (/(Header|Footer|Sidebar|Navigation|Nav|MobileNav)/i.test(name)) {
    return "persistent-ui";
  }
  if (/(Toaster|Modal|CommandPalette|GlobalModal)/i.test(name)) {
    return "overlay-ui";
  }
  return "component";
};

const isChildrenSlotExpression = (expr: Node): boolean => {
  if (expr.isKind(SyntaxKind.Identifier)) {
    return expr.getText() === "children";
  }
  if (expr.isKind(SyntaxKind.PropertyAccessExpression)) {
    const text = expr.getText();
    return text === "props.children" || text.endsWith(".children");
  }
  return false;
};

const deriveRouteSegment = (
  entryFile: string
): {
  routeSegment?: string;
  routeGroup?: string;
  isRootLayout: boolean;
} => {
  const normalized = entryFile.replaceAll("\\", "/");
  const rootMatch = normalized.match(/\/app\/layout\.tsx$/);
  if (rootMatch) {
    return { isRootLayout: true, routeSegment: "/" };
  }

  const segmentMatch = normalized.match(/\/app\/(.+)\/layout\.tsx$/);
  if (!segmentMatch) {
    return { isRootLayout: false };
  }

  const segmentPath = segmentMatch[1]!;
  const routeGroups = segmentPath.match(/\([^)]+\)/g)?.join("") ?? undefined;

  return {
    isRootLayout: false,
    routeGroup: routeGroups,
    routeSegment: segmentPath,
  };
};

const classifyDependency = (
  importName: string,
  importPath: string
): LayoutDependencyTrace["kind"] => {
  if (isProviderName(importName)) {
    return "provider";
  }
  if (importPath.startsWith(".") || importPath.startsWith("@/")) {
    return "component";
  }
  if (
    importPath === "next/navigation" ||
    importPath === "next/headers" ||
    importPath === "next/cache"
  ) {
    return "utility";
  }
  if (importPath.startsWith(".") === false && !importPath.startsWith("@/")) {
    return "external";
  }
  return "unknown";
};

const extractProps = (propNames: string[]): LayoutPropTrace[] =>
  propNames.map((name) => ({
    isParams: name === "params",
    isReactNode: name === "children",
    isSearchParams: name === "searchParams",
    name,
  }));

const findReturnExpression = (body: Node | undefined): Node | undefined => {
  if (!body) {
    return undefined;
  }

  if (body.isKind(SyntaxKind.Block)) {
    for (const statement of body.getStatements()) {
      if (statement.isKind(SyntaxKind.ReturnStatement)) {
        const argument = statement.getExpression();
        return argument ? unwrapExpression(argument) : undefined;
      }
    }
    return undefined;
  }

  return unwrapExpression(body);
};

const propsRecordFromJsx = (
  node: JsxElement | JsxSelfClosingElement,
  filePath: string
): Record<string, string> | undefined => {
  const props = analyzeJsxProps(node, filePath);
  if (props.length === 0) {
    return undefined;
  }
  return Object.fromEntries(
    props.map((prop) => [prop.name, prop.expression || "true"])
  );
};

const visitLayoutJsx = (
  node: Node,
  filePath: string,
  renders: LayoutRenderTrace[],
  providers: LayoutProviderTrace[],
  slots: LayoutSlotTrace[],
  seenSlots: Set<string>
): void => {
  if (node.isKind(SyntaxKind.JsxFragment)) {
    for (const child of node.getJsxChildren()) {
      visitLayoutJsx(child, filePath, renders, providers, slots, seenSlots);
    }
    return;
  }

  if (node.isKind(SyntaxKind.JsxExpression)) {
    const expr = node.getExpression();
    if (expr && isChildrenSlotExpression(expr)) {
      const loc = getSourceLocation(node, filePath);
      const key = `children:${loc.startLine}`;
      if (!seenSlots.has(key)) {
        seenSlots.add(key);
        slots.push({
          kind: "children",
          name: "children",
          rendered: true,
          renderedAt: {
            code: getNodeText(node.getParent() ?? node),
            file: filePath,
            line: loc.startLine,
          },
        });
      }
    }
    return;
  }

  if (
    !node.isKind(SyntaxKind.JsxElement) &&
    !node.isKind(SyntaxKind.JsxSelfClosingElement)
  ) {
    return;
  }

  const jsxNode = node as JsxElement | JsxSelfClosingElement;
  const tagName = getJsxTagName(jsxNode);
  const loc = getSourceLocation(jsxNode, filePath);

  if (isHtmlElement(tagName)) {
    if (jsxNode.isKind(SyntaxKind.JsxElement)) {
      for (const child of getJsxChildren(jsxNode)) {
        if (child.isKind(SyntaxKind.JsxExpression)) {
          const expr = child.getExpression();
          if (expr && isChildrenSlotExpression(expr)) {
            const key = `children:${loc.startLine}`;
            if (!seenSlots.has(key)) {
              seenSlots.add(key);
              slots.push({
                kind: "children",
                name: "children",
                rendered: true,
                renderedAt: {
                  code: getNodeText(jsxNode),
                  file: filePath,
                  line: loc.startLine,
                },
              });
            }
            continue;
          }
        }
        visitLayoutJsx(child, filePath, renders, providers, slots, seenSlots);
      }
    }
    return;
  }

  if (!isReactComponentTag(tagName)) {
    return;
  }

  const props = propsRecordFromJsx(jsxNode, filePath);

  if (isProviderName(tagName)) {
    providers.push({
      file: filePath,
      line: loc.startLine,
      name: tagName,
      wrapsChildren: true,
    });
  } else {
    renders.push({
      classification: classifyRender(tagName),
      component: tagName,
      file: filePath,
      line: loc.startLine,
      props,
    });
  }

  if (jsxNode.isKind(SyntaxKind.JsxElement)) {
    for (const child of getJsxChildren(jsxNode)) {
      if (child.isKind(SyntaxKind.JsxExpression)) {
        const expr = child.getExpression();
        if (expr && isChildrenSlotExpression(expr)) {
          const key = `children:${loc.startLine}:${tagName}`;
          if (!seenSlots.has(key)) {
            seenSlots.add(key);
            slots.push({
              kind: "children",
              name: "children",
              rendered: true,
              renderedAt: {
                code: `<${tagName}>…{children}…</${tagName}>`,
                file: filePath,
                line: getSourceLocation(child, filePath).startLine,
              },
            });
          }
          continue;
        }
      }
      visitLayoutJsx(child, filePath, renders, providers, slots, seenSlots);
    }
  }
};

const extractDataSources = (
  body: Node | undefined,
  filePath: string
): LayoutDataSourceTrace[] => {
  if (!body) {
    return [];
  }

  const sources: LayoutDataSourceTrace[] = [];
  for (const awaitNode of collectAwaitCalls(body)) {
    const innerExpr = awaitNode.isKind(SyntaxKind.AwaitExpression)
      ? awaitNode.getExpression()
      : awaitNode;
    if (!innerExpr?.isKind(SyntaxKind.CallExpression)) {
      continue;
    }
    const call = innerExpr as CallExpression;
    const callText = getNodeText(call);
    const loc = getSourceLocation(call, filePath);
    sources.push({
      call: callText,
      file: filePath,
      line: loc.startLine,
    });
  }
  return sources;
};

const extractGuards = (
  body: Node | undefined,
  filePath: string
): LayoutGuardTrace[] => {
  if (!body) {
    return [];
  }

  const guards: LayoutGuardTrace[] = [];
  const visit = (node: Node): void => {
    if (node.isKind(SyntaxKind.CallExpression)) {
      const call = node as CallExpression;
      const expression = call.getExpression();
      const callee = expression.isKind(SyntaxKind.Identifier)
        ? expression.getText()
        : (expression.isKind(SyntaxKind.PropertyAccessExpression)
          ? expression.getName()
          : undefined);

      if (callee && GUARD_CALLEES.has(callee)) {
        const loc = getSourceLocation(call, filePath);
        const firstArg = call.getArguments()[0];
        guards.push({
          action: callee as LayoutGuardTrace["action"],
          condition: node.getParent()?.isKind(SyntaxKind.IfStatement)
            ? getNodeText(
                (
                  node.getParent() as import("ts-morph").IfStatement
                ).getExpression()
              )
            : undefined,
          file: filePath,
          line: loc.startLine,
          target: firstArg ? getNodeText(firstArg) : undefined,
        });
      }
    }
    node.forEachChild(visit);
  };

  body.forEachChild(visit);
  return guards;
};

const readMetadataTrace = (sourceFile: SourceFile): LayoutMetadataTrace => {
  for (const statement of sourceFile.getStatements()) {
    if (!statement.isKind(SyntaxKind.VariableStatement)) {
      continue;
    }
    const isExported = statement
      .getModifiers()
      .some((modifier) => modifier.getKind() === SyntaxKind.ExportKeyword);
    if (!isExported) {
      continue;
    }
    for (const declaration of statement
      .getDeclarationList()
      .getDeclarations()) {
      if (declaration.getName() === "metadata") {
        return {
          fields: { export: "metadata" },
          kind: "static",
        };
      }
    }
  }

  for (const fn of sourceFile.getFunctions()) {
    if (
      fn.isExported() &&
      (fn.getName() === "generateMetadata" ||
        fn.getName() === "generateViewport")
    ) {
      return { kind: "dynamic" };
    }
  }

  return { kind: "none" };
};

const readSegmentConfig = (
  sourceFile: SourceFile
): LayoutSegmentConfigTrace | undefined => {
  const config: LayoutSegmentConfigTrace = {};
  let found = false;

  for (const statement of sourceFile.getStatements()) {
    if (!statement.isKind(SyntaxKind.VariableStatement)) {
      continue;
    }
    const isExported = statement
      .getModifiers()
      .some((modifier) => modifier.getKind() === SyntaxKind.ExportKeyword);
    if (!isExported) {
      continue;
    }
    for (const declaration of statement
      .getDeclarationList()
      .getDeclarations()) {
      const name = declaration.getName();
      if (
        !SEGMENT_CONFIG_EXPORTS.includes(
          name as (typeof SEGMENT_CONFIG_EXPORTS)[number]
        )
      ) {
        continue;
      }
      found = true;
      const init = declaration.getInitializer();
      config[name as keyof LayoutSegmentConfigTrace] = init
        ? getNodeText(init).replaceAll(/^['"]|['"]$/g, "")
        : undefined;
    }
  }

  return found ? config : undefined;
};

const isClientComponentFile = (sourceFile: SourceFile): boolean => {
  const firstStatement = sourceFile.getStatements()[0];
  if (!firstStatement?.isKind(SyntaxKind.ExpressionStatement)) {
    return false;
  }
  const expression = firstStatement.getExpression();
  return (
    expression.isKind(SyntaxKind.StringLiteral) &&
    expression.getLiteralValue() === "use client"
  );
};

const buildDependencies = (
  imports: ImportInfo[],
  rootDir: string
): LayoutDependencyTrace[] =>
  imports.flatMap((info) => {
    const names = [
      ...(info.defaultImport ? [info.defaultImport] : []),
      ...info.namedImports,
    ];
    return names.map((importName) => ({
      importName,
      importPath: info.moduleSpecifier,
      kind: classifyDependency(importName, info.moduleSpecifier),
      resolvedPath: info.resolvedPath
        ? normalizePath(info.resolvedPath)
        : undefined,
    }));
  });

export const analyzeLayoutTrace = (
  options: AnalyzeLayoutTraceOptions
): LayoutTrace => {
  const rootDir = options.rootDir ?? process.cwd();
  const entryFile = resolveFromRoot(rootDir, options.entryFile);
  const relativeFile = normalizePath(
    entryFile.startsWith(rootDir)
      ? entryFile.slice(rootDir.length + 1)
      : options.entryFile
  );

  const diagnostics: LayoutDiagnostic[] = [];
  const segmentInfo = deriveRouteSegment(relativeFile);

  if (!existsSync(entryFile)) {
    return {
      dataSources: [],
      dependencies: [],
      diagnostics: [
        {
          file: relativeFile,
          level: "error",
          message: `Layout file not found: ${relativeFile}`,
        },
      ],
      guards: [],
      kind: "layout-trace",
      layout: {
        file: relativeFile,
        name: "Layout",
        ...segmentInfo,
      },
      props: [],
      providers: [],
      renders: [],
      slots: [],
    };
  }

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
  });
  const sourceFile = project.addSourceFileAtPath(entryFile);
  const component = findMainComponent(sourceFile);

  if (!component) {
    return {
      dataSources: [],
      dependencies: [],
      diagnostics: [
        {
          file: relativeFile,
          level: "error",
          message: "No default export layout component found",
        },
      ],
      guards: [],
      kind: "layout-trace",
      layout: {
        file: relativeFile,
        name: "Layout",
        ...segmentInfo,
      },
      props: [],
      providers: [],
      renders: [],
      slots: [],
    };
  }

  const tsConfigPath =
    options.tsConfigPath ?? findTsConfigForFile(rootDir, entryFile);

  const imports = analyzeImports({
    filePath: relativeFile,
    rootDir,
    sourceFile,
    tsConfigPath,
  });

  const props = extractProps(component.propNames ?? []);
  const receivesChildren = props.some((prop) => prop.name === "children");

  const renders: LayoutRenderTrace[] = [];
  const providers: LayoutProviderTrace[] = [];
  const slots: LayoutSlotTrace[] = [];
  const seenSlots = new Set<string>();

  const returnExpr = findReturnExpression(component.body);
  if (returnExpr && isJsxStructure(returnExpr)) {
    visitLayoutJsx(
      returnExpr,
      relativeFile,
      renders,
      providers,
      slots,
      seenSlots
    );
  }

  const childrenSlot = slots.find((slot) => slot.name === "children");
  if (childrenSlot && options.childrenTarget) {
    childrenSlot.target = options.childrenTarget;
    childrenSlot.targetKind = options.childrenTargetKind;
  }

  if (receivesChildren && !childrenSlot) {
    diagnostics.push({
      file: relativeFile,
      level: "warning",
      message: "Layout receives children but does not render children.",
    });
    slots.push({
      kind: "children",
      name: "children",
      rendered: false,
    });
  }

  const isClient = isClientComponentFile(sourceFile);
  if (isClient) {
    diagnostics.push({
      file: relativeFile,
      level: "info",
      message: "Layout is a Client Component.",
    });
  }

  const metadata = readMetadataTrace(sourceFile);
  if (metadata.kind === "static") {
    diagnostics.push({
      file: relativeFile,
      level: "info",
      message: "Layout exports static metadata.",
    });
  }

  const segmentConfig = readSegmentConfig(sourceFile);
  if (segmentConfig?.dynamic) {
    diagnostics.push({
      file: relativeFile,
      level: "info",
      message: `Layout exports dynamic = ${segmentConfig.dynamic}.`,
    });
  }

  return {
    dataSources: extractDataSources(component.body, relativeFile),
    dependencies: buildDependencies(imports, rootDir),
    diagnostics,
    guards: extractGuards(component.body, relativeFile),
    kind: "layout-trace",
    layout: {
      file: relativeFile,
      isClientComponent: isClient,
      line: component.body
        ? getSourceLocation(component.body, relativeFile).startLine
        : undefined,
      name: component.name,
      ...segmentInfo,
    },
    metadata: metadata.kind === "none" ? undefined : metadata,
    props,
    providers,
    renders,
    segmentConfig,
    slots,
  };
};

export const buildLayoutTracesForRoute = (
  graph: PageLogicGraph,
  options: { rootDir?: string; route?: string; tsConfigPath?: string } = {}
): Record<string, LayoutTrace> => {
  const chain = graph.routeChain ?? [];
  const traces: Record<string, LayoutTrace> = {};

  for (let index = 0; index < chain.length; index += 1) {
    const entry = chain[index]!;
    if (entry.kind !== "layout") {
      continue;
    }

    const nextEntry = chain[index + 1] as RouteChainEntry | undefined;
    traces[entry.filePath] = analyzeLayoutTrace({
      childrenTarget: nextEntry?.label,
      childrenTargetKind:
        nextEntry?.kind === "layout" || nextEntry?.kind === "page"
          ? nextEntry.kind
          : undefined,
      entryFile: entry.filePath,
      rootDir: options.rootDir,
      route: options.route,
      tsConfigPath: options.tsConfigPath,
    });
  }

  return traces;
};
