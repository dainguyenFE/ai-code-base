import type {
  ArrowFunction,
  Block,
  CallExpression,
  FunctionExpression,
  Node,
  ObjectLiteralExpression,
  PropertyAssignment,
  SourceFile,
  VariableDeclaration,
} from "ts-morph";
import { SyntaxKind } from "ts-morph";

import type {
  EffectHookTrace,
  EffectHookWarning,
  HookFlowStep,
  HookReturnFieldTrace,
  HookTraceView,
  SourceLocation,
} from "../types";
import { getNodeText, getSourceLocation } from "../utils/ast";
import { isCustomHookName, isReactBuiltInHook } from "../utils/reactHooks";
import { findComponentByName } from "./analyzeComponent";

const EFFECT_HOOKS = new Set([
  "useDebugValue",
  "useEffect",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
]);

const isHookName = (name: string): boolean => /^use[A-Z]/.test(name);

const isEffectHook = (name: string): boolean => EFFECT_HOOKS.has(name);

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

interface StateBinding {
  setter: string;
  stateVar: string;
  initExpression: string;
  loc?: SourceLocation;
}

interface HookBinding {
  argumentExpression?: string;
  hookName: string;
  varName: string;
  loc?: SourceLocation;
}

interface SetterCall {
  arg: string;
  loc?: SourceLocation;
  setter: string;
}

const collectStateBindings = (
  body: Block,
  filePath: string
): Map<string, StateBinding> => {
  const bindings = new Map<string, StateBinding>();

  for (const statement of body.getStatements()) {
    if (statement.isKind(SyntaxKind.ReturnStatement)) {
      break;
    }
    if (!statement.isKind(SyntaxKind.VariableStatement)) {
      continue;
    }
    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer?.isKind(SyntaxKind.CallExpression)) {
        continue;
      }
      const callName = extractCallName(initializer);
      if (callName !== "useState" && callName !== "useReducer") {
        continue;
      }
      const names = extractBindingNames(declaration);
      if (names.length < 2) {
        continue;
      }
      const [stateVar, setter] = names;
      if (!stateVar || !setter) {
        continue;
      }
      const initArg = (initializer as CallExpression).getArguments()[0];
      bindings.set(stateVar, {
        initExpression: initArg ? getNodeText(initArg) : "undefined",
        loc: getSourceLocation(declaration, filePath),
        setter,
        stateVar,
      });
    }
  }

  return bindings;
};

const collectHookBindings = (
  body: Block,
  filePath: string
): Map<string, HookBinding> => {
  const bindings = new Map<string, HookBinding>();

  for (const statement of body.getStatements()) {
    if (statement.isKind(SyntaxKind.ReturnStatement)) {
      break;
    }
    if (!statement.isKind(SyntaxKind.VariableStatement)) {
      continue;
    }
    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer?.isKind(SyntaxKind.CallExpression)) {
        continue;
      }
      const call = initializer as CallExpression;
      const callName = extractCallName(call);
      if (!callName || !isHookName(callName) || isEffectHook(callName)) {
        continue;
      }
      const argumentExpression = call.getArguments()[0]
        ? getNodeText(call.getArguments()[0]!)
        : undefined;
      const names = extractBindingNames(declaration);
      for (const varName of names) {
        bindings.set(varName, {
          argumentExpression,
          hookName: callName,
          loc: getSourceLocation(declaration, filePath),
          varName,
        });
      }
    }
  }

  return bindings;
};

const collectSetterCalls = (body: Block, filePath: string): SetterCall[] => {
  const calls: SetterCall[] = [];

  for (const statement of body.getStatements()) {
    if (statement.isKind(SyntaxKind.ReturnStatement)) {
      break;
    }

    const visitCall = (call: CallExpression) => {
      const callee = call.getExpression();
      if (!callee.isKind(SyntaxKind.Identifier)) {
        return;
      }
      const setter = callee.getText();
      if (!/^set[A-Z]/.test(setter)) {
        return;
      }
      const argNode = call.getArguments()[0];
      if (!argNode) {
        return;
      }
      calls.push({
        arg: getNodeText(argNode),
        loc: getSourceLocation(call, filePath),
        setter,
      });
    };

    if (statement.isKind(SyntaxKind.ExpressionStatement)) {
      const expr = statement.getExpression();
      if (expr?.isKind(SyntaxKind.CallExpression)) {
        visitCall(expr);
      }
    }

    if (statement.isKind(SyntaxKind.VariableStatement)) {
      continue;
    }
  }

  return calls;
};

const parseReturnFields = (
  body: Block,
  filePath: string
): { expression: string; loc?: SourceLocation; name: string }[] => {
  for (const statement of body.getStatements()) {
    if (!statement.isKind(SyntaxKind.ReturnStatement)) {
      continue;
    }
    const expr = statement.getExpression();
    if (!expr?.isKind(SyntaxKind.ObjectLiteralExpression)) {
      if (expr?.isKind(SyntaxKind.Identifier)) {
        return [
          {
            expression: expr.getText(),
            loc: getSourceLocation(expr, filePath),
            name: expr.getText(),
          },
        ];
      }
      return [];
    }

    const fields: {
      expression: string;
      loc?: SourceLocation;
      name: string;
    }[] = [];
    for (const property of (expr as ObjectLiteralExpression).getProperties()) {
      if (property.isKind(SyntaxKind.PropertyAssignment)) {
        const assignment = property as PropertyAssignment;
        const init = assignment.getInitializer();
        fields.push({
          expression: init ? getNodeText(init) : assignment.getName(),
          loc: getSourceLocation(assignment, filePath),
          name: assignment.getName(),
        });
      } else if (property.isKind(SyntaxKind.ShorthandPropertyAssignment)) {
        const name = property.getName();
        fields.push({
          expression: name,
          loc: getSourceLocation(property, filePath),
          name,
        });
      }
    }
    return fields;
  }
  return [];
};

const resolveNestedHookName = (
  arg: string,
  hookBindings: Map<string, HookBinding>
): string | undefined => {
  const root = arg.split(".")[0]?.trim();
  if (!root) {
    return undefined;
  }
  return hookBindings.get(root)?.hookName;
};

const buildFieldFlow = ({
  expression,
  fieldLoc,
  fieldName,
  filePath,
  hookBindings,
  setterCalls,
  stateBindings,
}: {
  expression: string;
  fieldLoc?: SourceLocation;
  fieldName: string;
  filePath: string;
  hookBindings: Map<string, HookBinding>;
  setterCalls: SetterCall[];
  stateBindings: Map<string, StateBinding>;
}): HookFlowStep[] => {
  const steps: HookFlowStep[] = [];
  const root = expression.split(".")[0]?.trim() ?? expression;

  const stateBinding = stateBindings.get(root);
  if (stateBinding && (expression === root || expression === fieldName)) {
    steps.push({
      expression: `useState(${stateBinding.initExpression})`,
      kind: "state-init",
      label: stateBinding.stateVar,
      loc: stateBinding.loc,
    });

    for (const call of setterCalls) {
      if (call.setter !== stateBinding.setter) {
        continue;
      }
      const nestedHookName = resolveNestedHookName(call.arg, hookBindings);
      steps.push({
        assignArg: call.arg,
        expression: `${call.setter}(${call.arg})`,
        kind: "state-assign",
        label: call.setter,
        loc: call.loc,
        nestedHookName,
      });
    }

    steps.push({
      expression: fieldName,
      kind: "return",
      label: fieldName,
      loc: fieldLoc,
    });
    return steps;
  }

  const hookBinding = hookBindings.get(root);
  if (hookBinding) {
    const isBuiltIn = isReactBuiltInHook(hookBinding.hookName);
    const callExpr = hookBinding.argumentExpression
      ? `${hookBinding.hookName}(${hookBinding.argumentExpression})`
      : `${hookBinding.hookName}()`;
    steps.push({
      builtInParamExpression: isBuiltIn
        ? hookBinding.argumentExpression
        : undefined,
      expression: `${hookBinding.varName} = ${callExpr}`,
      hookName: hookBinding.hookName,
      isBuiltIn,
      kind: "hook-call",
      label: isBuiltIn ? hookBinding.hookName : hookBinding.varName,
      loc: isBuiltIn ? undefined : hookBinding.loc,
      nestedHookName: isCustomHookName(hookBinding.hookName)
        ? hookBinding.hookName
        : undefined,
    });
    if (expression !== root) {
      steps.push({
        expression,
        kind: "derived",
        label: expression,
        loc: fieldLoc,
      });
    }
    steps.push({
      expression: fieldName,
      kind: "return",
      label: fieldName,
      loc: fieldLoc,
    });
    return steps;
  }

  if (expression !== fieldName) {
    steps.push({
      expression,
      kind: "derived",
      label: expression,
      loc: fieldLoc,
    });
  }
  steps.push({
    expression: fieldName,
    kind: "return",
    label: fieldName,
    loc: fieldLoc,
  });
  return steps;
};

const getEffectCallback = (
  call: CallExpression
): ArrowFunction | FunctionExpression | undefined => {
  const callback = call.getArguments()[0];
  if (
    callback?.isKind(SyntaxKind.ArrowFunction) ||
    callback?.isKind(SyntaxKind.FunctionExpression)
  ) {
    return callback;
  }
  return undefined;
};

const parseDependencyArray = (call: CallExpression): string[] => {
  const depsArg = call.getArguments()[1];
  if (!depsArg?.isKind(SyntaxKind.ArrayLiteralExpression)) {
    return [];
  }
  return depsArg
    .getElements()
    .map((element) => getNodeText(element))
    .filter(Boolean);
};

const scanEffectWarnings = (
  callbackBody: Node,
  filePath: string
): EffectHookWarning[] => {
  const warnings: EffectHookWarning[] = [];
  const seen = new Set<string>();

  callbackBody.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.CallExpression)) {
      return;
    }
    const call = node as CallExpression;
    const calleeText = getNodeText(call.getExpression());

    if (/\.setState\s*\(/.test(calleeText) || /^set[A-Z]/.test(calleeText)) {
      const key = `${calleeText}:${getSourceLocation(call, filePath).startLine}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      warnings.push({
        expression: getNodeText(call),
        kind: "set-state",
        loc: getSourceLocation(call, filePath),
        message:
          "Calls setState inside effect — may cause re-render loops if deps are wrong",
      });
      return;
    }

    if (/dispatch\s*\(/.test(calleeText)) {
      const key = `dispatch:${getSourceLocation(call, filePath).startLine}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      warnings.push({
        expression: getNodeText(call),
        kind: "context-update",
        loc: getSourceLocation(call, filePath),
        message:
          "Dispatches store/context update inside effect — verify deps to avoid loops",
      });
    }
  });

  return warnings;
};

const parseCleanup = (
  callback: ArrowFunction | FunctionExpression
): { cleanupExpression?: string; hasCleanup: boolean } => {
  const body = callback.getBody();
  if (!body?.isKind(SyntaxKind.Block)) {
    return { hasCleanup: false };
  }

  for (const statement of body.getStatements()) {
    if (!statement.isKind(SyntaxKind.ReturnStatement)) {
      continue;
    }
    const expr = statement.getExpression();
    if (
      expr?.isKind(SyntaxKind.ArrowFunction) ||
      expr?.isKind(SyntaxKind.FunctionExpression)
    ) {
      return {
        cleanupExpression: getNodeText(expr),
        hasCleanup: true,
      };
    }
  }

  return { hasCleanup: false };
};

const analyzeEffectCalls = (
  body: Block,
  filePath: string
): EffectHookTrace[] => {
  const effects: EffectHookTrace[] = [];

  for (const statement of body.getStatements()) {
    if (statement.isKind(SyntaxKind.ReturnStatement)) {
      break;
    }

    const visitCall = (call: CallExpression) => {
      const hookName = extractCallName(call);
      if (!hookName || !isEffectHook(hookName)) {
        return;
      }

      const callback = getEffectCallback(call);
      const { cleanupExpression, hasCleanup } = callback
        ? parseCleanup(callback)
        : { hasCleanup: false };
      const warnings = callback
        ? scanEffectWarnings(callback.getBody() ?? callback, filePath)
        : [];

      effects.push({
        callExpression: getNodeText(call),
        cleanupExpression,
        dependencies: parseDependencyArray(call),
        hasCleanup,
        hookName,
        loc: getSourceLocation(call, filePath),
        warnings,
      });
    };

    if (statement.isKind(SyntaxKind.ExpressionStatement)) {
      const expr = statement.getExpression();
      if (expr?.isKind(SyntaxKind.CallExpression)) {
        visitCall(expr);
      }
    }

    if (statement.isKind(SyntaxKind.VariableStatement)) {
      for (const declaration of statement.getDeclarations()) {
        const initializer = declaration.getInitializer();
        if (initializer?.isKind(SyntaxKind.CallExpression)) {
          visitCall(initializer);
        }
      }
    }
  }

  return effects;
};

export const analyzeHookTraceFromBody = ({
  body,
  filePath,
  hookName,
  hookNodeId,
}: {
  body: Node;
  filePath: string;
  hookName: string;
  hookNodeId: string;
}): HookTraceView | undefined => {
  if (!body.isKind(SyntaxKind.Block)) {
    return undefined;
  }

  const stateBindings = collectStateBindings(body, filePath);
  const hookBindings = collectHookBindings(body, filePath);
  const setterCalls = collectSetterCalls(body, filePath);
  const returnFields = parseReturnFields(body, filePath);

  const fieldTraces: HookReturnFieldTrace[] = returnFields.map((field) => ({
    name: field.name,
    steps: buildFieldFlow({
      expression: field.expression,
      fieldLoc: field.loc,
      fieldName: field.name,
      filePath,
      hookBindings,
      setterCalls,
      stateBindings,
    }),
  }));

  return {
    effects: analyzeEffectCalls(body, filePath),
    hookName,
    hookNodeId,
    inputs: [],
    returnFields: fieldTraces,
    traceScope: "full",
  };
};

export const analyzeHookTraceFromSource = ({
  filePath,
  hookName,
  hookNodeId,
  sourceFile,
}: {
  filePath: string;
  hookName: string;
  hookNodeId: string;
  sourceFile: SourceFile;
}): HookTraceView | undefined => {
  const component = findComponentByName(sourceFile, hookName);
  if (!component?.body) {
    return undefined;
  }

  return analyzeHookTraceFromBody({
    body: component.body,
    filePath,
    hookName,
    hookNodeId,
  });
};

export const collectComponentHookBindings = (
  sourceFile: SourceFile,
  filePath: string,
  componentName: string
): Map<
  string,
  {
    argumentExpression?: string;
    hookName: string;
    loc?: SourceLocation;
    varName: string;
  }
> => {
  const component = findComponentByName(sourceFile, componentName);
  if (!component?.body?.isKind(SyntaxKind.Block)) {
    return new Map();
  }
  return collectHookBindings(component.body, filePath);
};
