import type {
  DynamicImportRef,
  PassedPropAttribute,
  PassedPropTarget,
} from "@ai-trace/types";
import { Node, SyntaxKind } from "ts-morph";
import type { Node as MorphNode } from "ts-morph";

import { isPascalCase } from "./utils.js";

function formatAttributeValue(init: MorphNode | undefined): string {
  if (!init) {
    return "true";
  }
  if (Node.isStringLiteral(init)) {
    return JSON.stringify(init.getLiteralValue());
  }
  return init.getText().slice(0, 100);
}

export function collectPassedProps(node: MorphNode): PassedPropTarget[] {
  const results: PassedPropTarget[] = [];

  node.forEachDescendant((child) => {
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

    const attributes: PassedPropAttribute[] = [];
    for (const attr of child.getAttributes()) {
      if (!Node.isJsxAttribute(attr)) {
        continue;
      }
      attributes.push({
        name: attr.getNameNode().getText(),
        value: formatAttributeValue(attr.getInitializer()),
      });
    }

    if (attributes.length > 0) {
      results.push({ attributes, target: tag });
    }
  });

  return results;
}

function extractImportSpecifierFromNode(node: MorphNode): string | null {
  if (Node.isCallExpression(node)) {
    const expr = node.getExpression();
    if (expr.getKind() === SyntaxKind.ImportKeyword) {
      const arg = node.getArguments()[0];
      if (arg && Node.isStringLiteral(arg)) {
        return arg.getLiteralValue();
      }
    }
  }

  return null;
}

export function collectDynamicImports(node: MorphNode): DynamicImportRef[] {
  const results: DynamicImportRef[] = [];
  const wrappedImportLines = new Set<number>();

  node.forEachDescendant((child) => {
    if (!Node.isCallExpression(child)) {
      return;
    }

    const expr = child.getExpression();
    if (!Node.isIdentifier(expr)) {
      return;
    }

    const callee = expr.getText();
    if (callee !== "dynamic" && callee !== "lazy") {
      return;
    }

    const callback = child.getArguments()[0];
    if (!callback) {
      return;
    }

    callback.forEachDescendant((inner) => {
      const specifier = extractImportSpecifierFromNode(inner);
      if (!specifier) {
        return;
      }

      wrappedImportLines.add(inner.getStartLineNumber());
      results.push({
        kind: callee === "dynamic" ? "next/dynamic" : "react/lazy",
        line: child.getStartLineNumber(),
        moduleSpecifier: specifier,
      });
    });
  });

  node.forEachDescendant((child) => {
    if (!Node.isCallExpression(child)) {
      return;
    }

    const directImport = extractImportSpecifierFromNode(child);
    if (!directImport || wrappedImportLines.has(child.getStartLineNumber())) {
      return;
    }

    results.push({
      kind: "import()",
      line: child.getStartLineNumber(),
      moduleSpecifier: directImport,
    });
  });

  return results;
}

export function formatPassedPropsSummary(
  passedProps: PassedPropTarget[]
): string {
  return passedProps
    .map((entry) => {
      const attrs = entry.attributes
        .map((attr) => `${attr.name}=${attr.value}`)
        .join(", ");
      return `${entry.target}(${attrs})`;
    })
    .join("; ");
}
