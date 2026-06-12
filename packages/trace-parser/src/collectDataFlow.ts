import type {
  CallSiteRecord,
  DataFlowNode,
  PropFlowRecord,
} from "@ai-trace/types";
import { Node, SyntaxKind } from "ts-morph";
import type { Node as MorphNode } from "ts-morph";

import { isHookName, isPascalCase } from "./utils.js";

const MAX_FLOW_DEPTH = 14;
const MAX_EXPR_LEN = 160;

function clip(text: string): string {
  return text.length > MAX_EXPR_LEN ? `${text.slice(0, MAX_EXPR_LEN)}…` : text;
}

function isBooleanLiteral(expr: MorphNode): boolean {
  const kind = expr.getKind();
  return kind === SyntaxKind.TrueKeyword || kind === SyntaxKind.FalseKeyword;
}

function literalKind(expr: MorphNode): DataFlowNode["kind"] {
  if (
    Node.isStringLiteral(expr) ||
    Node.isNumericLiteral(expr) ||
    isBooleanLiteral(expr) ||
    expr.getKind() === SyntaxKind.NullKeyword
  ) {
    return "literal";
  }
  return "unknown";
}

function bindingElementInitializer(
  binding: import("ts-morph").BindingElement
): MorphNode | undefined {
  const varDecl = binding.getFirstAncestorByKind(
    SyntaxKind.VariableDeclaration
  );
  return varDecl?.getInitializer();
}

function resolveBindingElement(
  binding: import("ts-morph").BindingElement,
  scopeRoot: MorphNode,
  depth: number
): DataFlowNode {
  const name = binding.getName();
  const init = bindingElementInitializer(binding);

  if (init) {
    const parentFlow = resolveExpressionFlow(init, scopeRoot, depth + 1);
    return {
      children: [parentFlow],
      expression: clip(`${name} ← ${init.getText()}`),
      kind: "destructure",
      line: binding.getStartLineNumber(),
      name,
    };
  }

  return {
    expression: name,
    kind: "destructure",
    line: binding.getStartLineNumber(),
    name,
  };
}

function resolveIdentifierFlow(
  identifier: import("ts-morph").Identifier,
  scopeRoot: MorphNode,
  depth: number
): DataFlowNode {
  const name = identifier.getText();
  const line = identifier.getStartLineNumber();

  if (isHookName(name)) {
    return {
      callee: name,
      expression: name,
      kind: "hook_call",
      line,
      name,
    };
  }

  const definitions = identifier.getDefinitionNodes();
  if (definitions.length === 0) {
    return {
      expression: name,
      kind: "identifier",
      line,
      name,
    };
  }

  const decl = definitions[0];

  if (Node.isParameterDeclaration(decl)) {
    return {
      expression: name,
      kind: "parameter",
      line: decl.getStartLineNumber(),
      name,
    };
  }

  if (Node.isBindingElement(decl)) {
    return resolveBindingElement(decl, scopeRoot, depth);
  }

  if (Node.isVariableDeclaration(decl)) {
    const init = decl.getInitializer();
    if (init) {
      const valueFlow = resolveExpressionFlow(init, scopeRoot, depth + 1);
      return {
        children: [valueFlow],
        expression: clip(init.getText()),
        kind: "identifier",
        line: decl.getStartLineNumber(),
        name,
      };
    }
  }

  if (Node.isImportSpecifier(decl) || Node.isImportClause(decl)) {
    return {
      expression: name,
      kind: "identifier",
      line,
      name,
    };
  }

  return {
    expression: name,
    kind: "identifier",
    line,
    name,
  };
}

export function resolveExpressionFlow(
  expr: MorphNode,
  scopeRoot: MorphNode,
  depth = 0
): DataFlowNode {
  if (depth > MAX_FLOW_DEPTH) {
    return {
      expression: clip(expr.getText()),
      kind: "unknown",
      line: expr.getStartLineNumber(),
    };
  }

  const line = expr.getStartLineNumber();

  if (Node.isIdentifier(expr)) {
    return resolveIdentifierFlow(expr, scopeRoot, depth);
  }

  if (
    Node.isStringLiteral(expr) ||
    Node.isNumericLiteral(expr) ||
    isBooleanLiteral(expr) ||
    expr.getKind() === SyntaxKind.NullKeyword
  ) {
    return {
      expression: clip(expr.getText()),
      kind: literalKind(expr),
      line,
    };
  }

  if (Node.isCallExpression(expr)) {
    const calleeExpr = expr.getExpression();
    let callee = calleeExpr.getText();
    let calleeFlow: DataFlowNode | undefined;

    if (
      Node.isIdentifier(calleeExpr) ||
      Node.isPropertyAccessExpression(calleeExpr)
    ) {
      calleeFlow = resolveExpressionFlow(calleeExpr, scopeRoot, depth + 1);
      if (Node.isIdentifier(calleeExpr)) {
        callee = calleeExpr.getText();
      } else {
        callee = calleeExpr.getName();
      }
    }

    const rootCallee = callee.split(".")[0] ?? callee;
    const argFlows = expr
      .getArguments()
      .map((arg) => resolveExpressionFlow(arg, scopeRoot, depth + 1));

    return {
      callee,
      children: [...(calleeFlow ? [calleeFlow] : []), ...argFlows],
      expression: clip(expr.getText()),
      kind: isHookName(rootCallee) ? "hook_call" : "call",
      line,
      name: rootCallee,
    };
  }

  if (Node.isPropertyAccessExpression(expr)) {
    const objectFlow = resolveExpressionFlow(
      expr.getExpression(),
      scopeRoot,
      depth + 1
    );
    const property = expr.getName();

    return {
      children: [objectFlow],
      expression: clip(expr.getText()),
      kind: "member",
      line,
      name: property,
      property,
    };
  }

  if (Node.isElementAccessExpression(expr)) {
    const objectFlow = resolveExpressionFlow(
      expr.getExpression(),
      scopeRoot,
      depth + 1
    );
    const indexExpr = expr.getArgumentExpression();
    const children = indexExpr
      ? [objectFlow, resolveExpressionFlow(indexExpr, scopeRoot, depth + 1)]
      : [objectFlow];

    return {
      children,
      expression: clip(expr.getText()),
      kind: "member",
      line,
    };
  }

  if (Node.isAwaitExpression(expr)) {
    const inner = resolveExpressionFlow(
      expr.getExpression(),
      scopeRoot,
      depth + 1
    );
    return {
      children: [inner],
      expression: clip(expr.getText()),
      kind: "await",
      line,
    };
  }

  if (Node.isConditionalExpression(expr)) {
    const whenTrue = resolveExpressionFlow(
      expr.getWhenTrue(),
      scopeRoot,
      depth + 1
    );
    const whenFalse = resolveExpressionFlow(
      expr.getWhenFalse(),
      scopeRoot,
      depth + 1
    );

    return {
      children: [whenTrue, whenFalse],
      expression: clip(expr.getText()),
      kind: "unknown",
      line,
    };
  }

  if (Node.isParenthesizedExpression(expr)) {
    return resolveExpressionFlow(expr.getExpression(), scopeRoot, depth + 1);
  }

  if (Node.isAsExpression(expr) || Node.isSatisfiesExpression(expr)) {
    return resolveExpressionFlow(expr.getExpression(), scopeRoot, depth + 1);
  }

  return {
    expression: clip(expr.getText()),
    kind: "unknown",
    line,
  };
}

export function collectPropFlows(bodyNode: MorphNode): PropFlowRecord[] {
  const results: PropFlowRecord[] = [];

  bodyNode.forEachDescendant((child) => {
    if (
      !Node.isJsxSelfClosingElement(child) &&
      !Node.isJsxOpeningElement(child)
    ) {
      return;
    }

    const tag = child.getTagNameNode().getText();
    if (!isPascalCase(tag)) {
      return;
    }

    for (const attr of child.getAttributes()) {
      if (!Node.isJsxAttribute(attr)) {
        continue;
      }

      const propName = attr.getNameNode().getText();
      const init = attr.getInitializer();

      if (!init) {
        continue;
      }

      if (Node.isStringLiteral(init)) {
        results.push({
          jsxValue: JSON.stringify(init.getLiteralValue()),
          line: attr.getStartLineNumber(),
          propName,
          source: {
            expression: init.getText(),
            kind: "literal",
            line: init.getStartLineNumber(),
          },
          targetComponent: tag,
        });
        continue;
      }

      if (Node.isJsxExpression(init)) {
        const expr = init.getExpression();
        if (!expr) {
          continue;
        }

        results.push({
          jsxValue: `{${clip(expr.getText())}}`,
          line: attr.getStartLineNumber(),
          propName,
          source: resolveExpressionFlow(expr, bodyNode),
          targetComponent: tag,
        });
      }
    }
  });

  return results;
}

export function collectCallSites(bodyNode: MorphNode): CallSiteRecord[] {
  const sites: CallSiteRecord[] = [];
  const seen = new Set<string>();

  bodyNode.forEachDescendant((child) => {
    if (!Node.isCallExpression(child)) {
      return;
    }

    const key = `${child.getStartLineNumber()}:${child.getStart()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    const expr = child.getExpression();
    let callee: string;

    if (Node.isIdentifier(expr)) {
      callee = expr.getText();
    } else if (Node.isPropertyAccessExpression(expr)) {
      callee = `${expr.getExpression().getText()}.${expr.getName()}`;
    } else {
      callee = clip(expr.getText());
    }

    sites.push({
      argumentExpressions: child
        .getArguments()
        .map((arg) => clip(arg.getText())),
      callee,
      expression: clip(child.getText()),
      line: child.getStartLineNumber(),
    });
  });

  return sites;
}

/** Extract primary resolvable callee from a parsed data-flow tree. */
export function primaryCalleeFromFlow(flow: DataFlowNode): string | null {
  if (flow.kind === "call" || flow.kind === "hook_call") {
    return flow.callee ?? flow.name ?? null;
  }

  for (const child of flow.children ?? []) {
    const nested = primaryCalleeFromFlow(child);
    if (nested) {
      return nested;
    }
  }

  return null;
}
