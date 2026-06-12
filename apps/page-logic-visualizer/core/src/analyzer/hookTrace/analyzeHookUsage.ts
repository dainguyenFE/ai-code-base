import type { Node, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";

import type { HookUsage, HookUsageKind } from "../../types";
import {
  getJsxAttributes,
  getJsxTagName,
  getNodeText,
  getSourceLocation,
} from "../../utils/ast";

const matchesAccessPath = (expression: string, accessPath: string): boolean => {
  if (expression === accessPath) {
    return true;
  }
  if (accessPath.includes(".")) {
    return expression === accessPath || expression.startsWith(`${accessPath}.`);
  }
  const root = accessPath.split(".")[0];
  return expression === root || expression.startsWith(`${root}.`);
};

const expressionReferencesAccessPath = (
  node: Node,
  accessPath: string
): boolean => {
  const root = accessPath.split(".")[0] ?? accessPath;
  if (node.isKind(SyntaxKind.Identifier)) {
    const text = node.getText();
    return text === root || matchesAccessPath(text, accessPath);
  }

  let found = false;
  node.forEachDescendant((child) => {
    if (!child.isKind(SyntaxKind.Identifier)) {
      return;
    }
    const text = child.getText();
    if (text === root || matchesAccessPath(text, accessPath)) {
      found = true;
    }
  });
  return found;
};

const pushUsage = (
  usages: HookUsage[],
  seen: Set<string>,
  usage: HookUsage
): void => {
  const key = `${usage.kind}:${usage.label}:${usage.line ?? 0}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  usages.push(usage);
};

const unwrapExpression = (node: Node): Node => {
  if (node.isKind(SyntaxKind.ParenthesizedExpression)) {
    const inner = node.getExpression();
    return inner ? unwrapExpression(inner) : node;
  }
  return node;
};

const isJsxReturnExpression = (node: Node): boolean => {
  const unwrapped = unwrapExpression(node);
  return (
    unwrapped.isKind(SyntaxKind.JsxElement) ||
    unwrapped.isKind(SyntaxKind.JsxFragment) ||
    unwrapped.isKind(SyntaxKind.JsxSelfClosingElement)
  );
};

export const analyzeHookUsages = ({
  accessPath,
  body,
  filePath,
  sourceFile,
}: {
  accessPath: string;
  body: Node;
  filePath: string;
  sourceFile: SourceFile;
}): HookUsage[] => {
  const usages: HookUsage[] = [];
  const seen = new Set<string>();
  const root = accessPath.split(".")[0] ?? accessPath;

  body.forEachDescendant((node) => {
    if (
      node.isKind(SyntaxKind.JsxElement) ||
      node.isKind(SyntaxKind.JsxSelfClosingElement)
    ) {
      const tagName = getJsxTagName(node);
      for (const attribute of getJsxAttributes(node)) {
        const propName = attribute.getNameNode().getText();
        const initializer = attribute.getInitializer();
        if (!initializer?.isKind(SyntaxKind.JsxExpression)) {
          continue;
        }
        const expr = initializer.getExpression();
        if (!expr) {
          continue;
        }
        const expression = getNodeText(expr);
        if (!matchesAccessPath(expression, accessPath)) {
          continue;
        }
        const loc = getSourceLocation(attribute, filePath);
        pushUsage(usages, seen, {
          code: expression,
          file: filePath,
          kind: "jsx-prop",
          label: `<${tagName} ${propName}={${expression}}>`,
          line: loc.startLine,
        });
      }
      return;
    }

    if (node.isKind(SyntaxKind.JsxExpression)) {
      const expr = node.getExpression();
      if (!expr) {
        return;
      }
      const expression = getNodeText(expr);
      if (!matchesAccessPath(expression, accessPath)) {
        return;
      }
      if (
        expr.getParent()?.isKind(SyntaxKind.JsxAttribute) ||
        expr.getParent()?.isKind(SyntaxKind.JsxElement) ||
        expr.getParent()?.isKind(SyntaxKind.JsxSelfClosingElement)
      ) {
        return;
      }
      const loc = getSourceLocation(expr, filePath);
      pushUsage(usages, seen, {
        code: expression,
        file: filePath,
        kind: "jsx-render",
        label: `{${expression}}`,
        line: loc.startLine,
      });
    }

    if (node.isKind(SyntaxKind.IfStatement)) {
      const condition = node.getExpression();
      if (!expressionReferencesAccessPath(condition, accessPath)) {
        return;
      }
      const loc = getSourceLocation(condition, filePath);
      pushUsage(usages, seen, {
        code: getNodeText(condition),
        file: filePath,
        kind: "condition",
        label: `if (${getNodeText(condition)})`,
        line: loc.startLine,
      });
      return;
    }

    if (node.isKind(SyntaxKind.ConditionalExpression)) {
      const condition = node.getCondition();
      if (!expressionReferencesAccessPath(condition, accessPath)) {
        return;
      }
      const loc = getSourceLocation(condition, filePath);
      pushUsage(usages, seen, {
        code: getNodeText(condition),
        file: filePath,
        kind: "condition",
        label: `condition ? … : … (${getNodeText(condition)})`,
        line: loc.startLine,
      });
      return;
    }

    if (node.isKind(SyntaxKind.ReturnStatement)) {
      const expression = node.getExpression();
      if (
        !expression ||
        !expressionReferencesAccessPath(expression, accessPath)
      ) {
        return;
      }
      const loc = getSourceLocation(expression, filePath);
      pushUsage(usages, seen, {
        code: getNodeText(expression),
        file: filePath,
        kind: "function-call",
        label: `return ${getNodeText(expression)}`,
        line: loc.startLine,
      });
      return;
    }

    if (node.isKind(SyntaxKind.CallExpression)) {
      const call = node as import("ts-morph").CallExpression;
      const calleeText = getNodeText(call.getExpression());
      if (/^set[A-Z]/.test(calleeText) || calleeText === "dispatch") {
        return;
      }

      for (const arg of call.getArguments()) {
        const expression = getNodeText(arg);
        if (!matchesAccessPath(expression, accessPath)) {
          continue;
        }
        const loc = getSourceLocation(arg, filePath);
        let kind: HookUsageKind = "function-call";
        if (/^on[A-Z]/.test(calleeText) || calleeText.includes("onClick")) {
          kind = "callback";
        }
        pushUsage(usages, seen, {
          code: `${calleeText}(${expression})`,
          file: filePath,
          kind,
          label: `${calleeText}(${expression})`,
          line: loc.startLine,
        });
      }
    }

    if (node.isKind(SyntaxKind.ArrayLiteralExpression)) {
      const parent = node.getParent();
      if (!parent?.isKind(SyntaxKind.CallExpression)) {
        return;
      }
      const call = parent as import("ts-morph").CallExpression;
      const hookName = getNodeText(call.getExpression());
      if (!/^use[A-Z]/.test(hookName)) {
        return;
      }
      for (const element of node.getElements()) {
        const expression = getNodeText(element);
        if (!matchesAccessPath(expression, accessPath)) {
          continue;
        }
        const loc = getSourceLocation(element, filePath);
        pushUsage(usages, seen, {
          code: expression,
          file: filePath,
          kind: "hook-arg",
          label: `${hookName} dependency [${expression}]`,
          line: loc.startLine,
        });
      }
    }
  });

  if (usages.length === 0) {
    const bodyText = getNodeText(body);
    if (bodyText.includes(`${root}.`) || bodyText.includes(`{${root}`)) {
      pushUsage(usages, seen, {
        file: filePath,
        kind: "jsx-prop",
        label: `${accessPath} referenced in component body`,
      });
    }
  }

  return usages;
};

export const analyzeAllHookUsages = ({
  bindingVariable,
  body,
  filePath,
  returnFieldNames,
  sourceFile,
}: {
  bindingVariable: string;
  body: Node;
  filePath: string;
  returnFieldNames: string[];
  sourceFile: SourceFile;
}): HookUsage[] => {
  const usages: HookUsage[] = [];
  const seen = new Set<string>();

  usages.push(
    ...analyzeHookUsages({
      accessPath: bindingVariable,
      body,
      filePath,
      sourceFile,
    })
  );
  for (const usage of usages) {
    seen.add(`${usage.kind}:${usage.label}:${usage.line ?? 0}`);
  }

  for (const fieldName of returnFieldNames) {
    const fieldUsages = analyzeHookUsages({
      accessPath: `${bindingVariable}.${fieldName}`,
      body,
      filePath,
      sourceFile,
    });
    for (const usage of fieldUsages) {
      const key = `${usage.kind}:${usage.label}:${usage.line ?? 0}`;
      if (!seen.has(key)) {
        seen.add(key);
        usages.push(usage);
      }
    }
  }

  return usages;
};
