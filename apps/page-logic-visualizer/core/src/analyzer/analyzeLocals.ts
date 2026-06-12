import type { CallExpression, Node, VariableDeclaration } from "ts-morph";
import { SyntaxKind } from "ts-morph";

import type { SourceLocation, UiLocalItem, UiLocalsMeta } from "../types";
import { getNodeText, getSourceLocation } from "../utils/ast";
import { hookCallNameFromGraphNode } from "../utils/hookNodeNames";
import type { AnalyzeFunctionBodyContext } from "./analyzeFunctionBody";

const isHookName = (name: string): boolean => /^use[A-Z]/.test(name);

/** Side-effect hooks — listed under Hooks, not Variables */
const EFFECT_HOOKS = new Set([
  "useDebugValue",
  "useEffect",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
]);

const isEffectHook = (name: string): boolean => EFFECT_HOOKS.has(name);

const isFunctionHook = (name: string): boolean => name === "useCallback";

const extractBindingNames = (declaration: VariableDeclaration): string[] => {
  const nameNode = declaration.getNameNode();
  if (nameNode.isKind(SyntaxKind.Identifier)) {
    return [nameNode.getText()];
  }
  if (nameNode.isKind(SyntaxKind.ObjectBindingPattern)) {
    return nameNode
      .getElements()
      .map((element) => element.getName())
      .filter(Boolean);
  }
  if (nameNode.isKind(SyntaxKind.ArrayBindingPattern)) {
    return nameNode
      .getElements()
      .map((element) => element.getName())
      .filter(Boolean);
  }
  return [];
};

const extractCallName = (node: Node): string | undefined => {
  if (!node.isKind(SyntaxKind.CallExpression)) {
    return undefined;
  }
  const call = node as CallExpression;
  const expression = call.getExpression();
  if (expression.isKind(SyntaxKind.Identifier)) {
    return expression.getText();
  }
  return getNodeText(expression);
};

const pushUnique = (items: UiLocalItem[], item: UiLocalItem): void => {
  if (items.some((existing) => existing.name === item.name)) {
    return;
  }
  items.push(item);
};

const getBindingPattern = (
  declaration: VariableDeclaration
): "array" | "identifier" | "object" => {
  const nameNode = declaration.getNameNode();
  if (nameNode.isKind(SyntaxKind.ArrayBindingPattern)) {
    return "array";
  }
  if (nameNode.isKind(SyntaxKind.ObjectBindingPattern)) {
    return "object";
  }
  return "identifier";
};

const isLikelyFunctionBinding = (
  name: string,
  index: number,
  total: number,
  pattern: "array" | "identifier" | "object"
): boolean => {
  if (/^set[A-Z]/.test(name)) {
    return true;
  }
  if (/^(handle|toggle|dispatch|mutate)[A-Z]/.test(name)) {
    return true;
  }
  if (/^select[A-Z]/.test(name)) {
    return true;
  }
  if (pattern === "array" && total === 2 && index === 1) {
    return true;
  }
  return false;
};

const addDataHookBindings = ({
  bindingNames,
  bindingPattern,
  callName,
  declarationText,
  loc,
  locals,
}: {
  bindingNames: string[];
  bindingPattern: "array" | "identifier" | "object";
  callName: string;
  declarationText: string;
  loc: SourceLocation;
  locals: UiLocalsMeta;
}): void => {
  for (const [index, name] of bindingNames.entries()) {
    const bucket =
      isLikelyFunctionBinding(
        name,
        index,
        bindingNames.length,
        bindingPattern
      ) || isFunctionHook(callName)
        ? locals.functions
        : locals.variables;

    pushUnique(bucket, {
      expression: declarationText,
      loc,
      name,
      sourceHook: callName,
    });
  }
};

const linkNodeIds = (
  locals: UiLocalsMeta,
  ctx: AnalyzeFunctionBodyContext
): UiLocalsMeta => {
  const dataFetchByOutput = new Map<string, string>();
  const hookByName = new Map<string, string>();
  const hookOutputByName = new Map<string, string>();

  for (const edge of ctx.graph.getEdges()) {
    if (edge.source !== ctx.parentNode.id) {
      continue;
    }
    const target = ctx.graph.getNode(edge.target);
    if (!target) {
      continue;
    }
    if (target.type === "data-fetch") {
      for (const output of target.dataFetch?.outputNames ?? []) {
        dataFetchByOutput.set(output, target.id);
      }
    }
    if (target.type === "hook") {
      const callName = hookCallNameFromGraphNode(target);
      if (callName) {
        hookByName.set(callName, target.id);
      }
      for (const output of target.hook?.outputs ?? []) {
        hookOutputByName.set(output.name, target.id);
      }
    }
    if (target.type === "context") {
      const callName = hookCallNameFromGraphNode(target);
      if (callName) {
        hookByName.set(callName, target.id);
      }
      for (const output of target.context?.outputNames ?? []) {
        hookOutputByName.set(output, target.id);
      }
    }
    if (target.type === "store") {
      const callName = hookCallNameFromGraphNode(target);
      if (callName) {
        hookByName.set(callName, target.id);
      }
      for (const output of target.store?.outputNames ?? []) {
        hookOutputByName.set(output, target.id);
      }
    }
  }

  const linkHookDerived = (item: UiLocalItem): UiLocalItem => ({
    ...item,
    nodeId:
      item.nodeId ??
      dataFetchByOutput.get(item.name) ??
      hookOutputByName.get(item.name) ??
      (item.sourceHook ? hookByName.get(item.sourceHook) : undefined),
  });

  return {
    ...locals,
    functions: locals.functions.map(linkHookDerived),
    hooks: locals.hooks.map((item) => ({
      ...item,
      nodeId: item.nodeId ?? hookByName.get(item.name),
    })),
    variables: locals.variables.map(linkHookDerived),
  };
};

const recordEffectHook = ({
  callName,
  expression,
  loc,
  locals,
}: {
  callName: string;
  expression: string;
  loc: SourceLocation;
  locals: UiLocalsMeta;
}): void => {
  pushUnique(locals.hooks, {
    expression,
    loc,
    name: callName,
  });
};

export const analyzeFunctionLocals = ({
  body,
  ctx,
  propNames,
}: {
  body: Node;
  ctx: AnalyzeFunctionBodyContext;
  propNames: string[];
}): UiLocalsMeta => {
  const locals: UiLocalsMeta = {
    functions: [],
    hooks: [],
    props: propNames.map((name) => ({ name })),
    variables: [],
  };

  if (!body.isKind(SyntaxKind.Block)) {
    return linkNodeIds(locals, ctx);
  }

  for (const statement of body.getStatements()) {
    if (statement.isKind(SyntaxKind.ReturnStatement)) {
      break;
    }

    if (statement.isKind(SyntaxKind.FunctionDeclaration)) {
      const fnName = statement.getName();
      if (fnName) {
        pushUnique(locals.functions, {
          expression: `function ${fnName}()`,
          name: fnName,
        });
      }
      continue;
    }

    if (statement.isKind(SyntaxKind.ExpressionStatement)) {
      const expression = statement.getExpression();
      if (expression?.isKind(SyntaxKind.CallExpression)) {
        const callName = extractCallName(expression);
        if (callName && isHookName(callName) && isEffectHook(callName)) {
          recordEffectHook({
            callName,
            expression: getNodeText(expression),
            loc: getSourceLocation(expression, ctx.filePath),
            locals,
          });
        }
      }
      continue;
    }

    if (!statement.isKind(SyntaxKind.VariableStatement)) {
      continue;
    }

    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      const bindingNames = extractBindingNames(declaration);
      const declarationText = getNodeText(declaration);
      const declarationLoc = getSourceLocation(declaration, ctx.filePath);

      if (initializer?.isKind(SyntaxKind.CallExpression)) {
        const callName = extractCallName(initializer);
        if (callName && isHookName(callName)) {
          if (isEffectHook(callName)) {
            recordEffectHook({
              callName,
              expression: getNodeText(initializer),
              loc: declarationLoc,
              locals,
            });
            continue;
          }

          addDataHookBindings({
            bindingNames,
            bindingPattern: getBindingPattern(declaration),
            callName,
            declarationText,
            loc: declarationLoc,
            locals,
          });
          continue;
        }
      }

      const awaitInitializer = declaration
        .getFirstDescendantByKind(SyntaxKind.AwaitExpression)
        ?.getExpression();

      if (
        initializer?.isKind(SyntaxKind.AwaitExpression) ||
        awaitInitializer?.isKind(SyntaxKind.CallExpression)
      ) {
        for (const name of bindingNames) {
          pushUnique(locals.variables, {
            expression: declarationText,
            loc: declarationLoc,
            name,
          });
        }
        continue;
      }

      if (
        initializer?.isKind(SyntaxKind.ArrowFunction) ||
        initializer?.isKind(SyntaxKind.FunctionExpression)
      ) {
        for (const name of bindingNames) {
          pushUnique(locals.functions, {
            expression: declarationText,
            loc: declarationLoc,
            name,
          });
        }
        continue;
      }

      if (initializer) {
        for (const name of bindingNames) {
          pushUnique(locals.variables, {
            expression: declarationText,
            loc: declarationLoc,
            name,
          });
        }
      }
    }
  }

  return linkNodeIds(locals, ctx);
};
