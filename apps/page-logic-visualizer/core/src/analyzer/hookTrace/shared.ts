import type {
  Block,
  CallExpression,
  Node,
  PropertyAssignment,
  ShorthandPropertyAssignment,
  SourceFile,
  VariableDeclaration,
} from "ts-morph";
import { SyntaxKind } from "ts-morph";

import type { SourceLocation } from "../../types";
import { getNodeText, getSourceLocation } from "../../utils/ast";
import { isCustomHookName, isReactBuiltInHook } from "../../utils/reactHooks";

export interface HookAssignmentBinding {
  variableName: string;
  hookName: string;
  argumentExpression?: string;
  callExpression: string;
  loc?: SourceLocation;
  destructuredFields?: string[];
}

export interface BodyVariableBinding {
  name: string;
  expression: string;
  kind:
    | "hook"
    | "builtin"
    | "state"
    | "memo"
    | "callback"
    | "effect"
    | "ref"
    | "derived";
  hookName?: string;
  argumentExpression?: string;
  dependencies: string[];
  transformBody?: string;
  loc?: SourceLocation;
}

export interface BodyReturnField {
  name: string;
  expression: string;
  loc?: SourceLocation;
}

export interface HookBodyAnalysis {
  variables: BodyVariableBinding[];
  returnFields: BodyReturnField[];
  nestedHookNames: string[];
}

export const isHookIdentifier = (name: string): boolean =>
  /^use[A-Z]/.test(name);

export const extractCallName = (node: Node): string | undefined => {
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

export const extractBindingNames = (
  declaration: VariableDeclaration
): string[] => {
  const nameNode = declaration.getNameNode();
  if (nameNode.isKind(SyntaxKind.Identifier)) {
    return [nameNode.getText()];
  }
  if (nameNode.isKind(SyntaxKind.ObjectBindingPattern)) {
    return nameNode
      .getElements()
      .map((element) => {
        const propertyName = element.getPropertyNameNode()?.getText();
        return propertyName ?? element.getName();
      })
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

export const parseDependencyArray = (call: CallExpression): string[] => {
  const depsArg = call.getArguments()[1];
  if (!depsArg?.isKind(SyntaxKind.ArrayLiteralExpression)) {
    return [];
  }
  return depsArg
    .getElements()
    .map((element) => getNodeText(element))
    .filter(Boolean);
};

export const parseReturnFields = (
  body: Block,
  filePath: string
): BodyReturnField[] => {
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

    const fields: BodyReturnField[] = [];
    for (const property of expr.getProperties()) {
      if (property.isKind(SyntaxKind.PropertyAssignment)) {
        const assignment = property as PropertyAssignment;
        const init = assignment.getInitializer();
        fields.push({
          expression: init ? getNodeText(init) : assignment.getName(),
          loc: getSourceLocation(assignment, filePath),
          name: assignment.getName(),
        });
      } else if (property.isKind(SyntaxKind.ShorthandPropertyAssignment)) {
        const shorthand = property as ShorthandPropertyAssignment;
        const name = shorthand.getName();
        fields.push({
          expression: name,
          loc: getSourceLocation(shorthand, filePath),
          name,
        });
      }
    }
    return fields;
  }
  return [];
};

export const classifyBuiltinHook = (
  hookName: string
): BodyVariableBinding["kind"] => {
  if (hookName === "useMemo") {
    return "memo";
  }
  if (hookName === "useCallback") {
    return "callback";
  }
  if (
    hookName === "useEffect" ||
    hookName === "useLayoutEffect" ||
    hookName === "useInsertionEffect"
  ) {
    return "effect";
  }
  if (hookName === "useState" || hookName === "useReducer") {
    return "state";
  }
  if (hookName === "useRef") {
    return "ref";
  }
  return "builtin";
};

export const detectHookAssignments = (
  sourceFile: SourceFile,
  filePath: string,
  variableName?: string
): HookAssignmentBinding[] => {
  const bindings: HookAssignmentBinding[] = [];

  sourceFile.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.VariableDeclaration)) {
      return;
    }
    const declaration = node as VariableDeclaration;
    const initializer = declaration.getInitializer();
    if (!initializer?.isKind(SyntaxKind.CallExpression)) {
      return;
    }
    const call = initializer as CallExpression;
    const hookName = extractCallName(call);
    if (!hookName || !isHookIdentifier(hookName)) {
      return;
    }

    const names = extractBindingNames(declaration);
    const primaryName = names[0];
    if (!primaryName) {
      return;
    }
    if (variableName && primaryName !== variableName) {
      return;
    }

    bindings.push({
      argumentExpression: call.getArguments()[0]
        ? getNodeText(call.getArguments()[0]!)
        : undefined,
      callExpression: getNodeText(call),
      destructuredFields: names.length > 1 ? names : undefined,
      hookName,
      loc: getSourceLocation(declaration, filePath),
      variableName: primaryName,
    });
  });

  return bindings;
};

export const analyzeHookBodyVariables = (
  body: Block,
  filePath: string
): HookBodyAnalysis => {
  const variables: BodyVariableBinding[] = [];
  const nestedHookNames: string[] = [];

  for (const statement of body.getStatements()) {
    if (statement.isKind(SyntaxKind.ReturnStatement)) {
      break;
    }

    if (statement.isKind(SyntaxKind.ExpressionStatement)) {
      const expr = statement.getExpression();
      if (expr?.isKind(SyntaxKind.CallExpression)) {
        const call = expr as CallExpression;
        const hookName = extractCallName(call);
        if (hookName && isHookIdentifier(hookName)) {
          const kind = classifyBuiltinHook(hookName);
          variables.push({
            argumentExpression: call.getArguments()[0]
              ? getNodeText(call.getArguments()[0]!)
              : undefined,
            dependencies: parseDependencyArray(call),
            expression: getNodeText(call),
            hookName,
            kind,
            loc: getSourceLocation(call, filePath),
            name: hookName,
            transformBody:
              kind === "effect" && call.getArguments()[0]
                ? getNodeText(call.getArguments()[0]!)
                : undefined,
          });
          if (isCustomHookName(hookName)) {
            nestedHookNames.push(hookName);
          }
        }
      }
      continue;
    }

    if (!statement.isKind(SyntaxKind.VariableStatement)) {
      continue;
    }

    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer) {
        continue;
      }

      if (initializer.isKind(SyntaxKind.CallExpression)) {
        const call = initializer as CallExpression;
        const hookName = extractCallName(call);
        if (!hookName || !isHookIdentifier(hookName)) {
          const names = extractBindingNames(declaration);
          const primaryName = names[0] ?? hookName ?? "result";
          variables.push({
            dependencies: [],
            expression: `${primaryName} = ${getNodeText(call)}`,
            hookName: hookName ?? undefined,
            kind: "derived",
            loc: getSourceLocation(declaration, filePath),
            name: primaryName,
          });
          continue;
        }

        const names = extractBindingNames(declaration);
        const primaryName = names[0] ?? hookName;
        const kind = isReactBuiltInHook(hookName)
          ? classifyBuiltinHook(hookName)
          : "hook";

        const callbackArg = call.getArguments()[0];
        variables.push({
          argumentExpression: call.getArguments()[0]
            ? getNodeText(call.getArguments()[0]!)
            : undefined,
          dependencies: parseDependencyArray(call),
          expression: `${primaryName} = ${getNodeText(call)}`,
          hookName,
          kind,
          loc: getSourceLocation(declaration, filePath),
          name: primaryName,
          transformBody:
            (kind === "memo" || kind === "callback") && callbackArg
              ? getNodeText(callbackArg)
              : undefined,
        });

        if (isCustomHookName(hookName)) {
          nestedHookNames.push(hookName);
        }
        continue;
      }

      const varName = declaration.getName();
      if (varName) {
        variables.push({
          dependencies: [],
          expression: getNodeText(initializer),
          kind: "derived",
          loc: getSourceLocation(declaration, filePath),
          name: varName,
        });
      }
    }
  }

  return {
    nestedHookNames: [...new Set(nestedHookNames)],
    returnFields: parseReturnFields(body, filePath),
    variables,
  };
};

export const rootIdentifier = (expression: string): string =>
  expression.match(/^([a-zA-Z_$][\w$]*)/)?.[1] ?? expression;

export const resolveSourceVariable = (
  expression: string,
  variables: BodyVariableBinding[]
): BodyVariableBinding | undefined => {
  const root = rootIdentifier(expression);
  return variables.find((item) => item.name === root);
};
