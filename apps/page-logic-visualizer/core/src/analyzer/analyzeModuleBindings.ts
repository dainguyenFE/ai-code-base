import type { CallExpression, Project, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";

import type { ImportInfo, ModuleBindingMeta } from "../types";
import { getNodeText, getSourceLocation } from "../utils/ast";
import { buildArgumentCallTreeForCall } from "./analyzeDataFetchSource";
import { findImportForIdentifier } from "./analyzeImports";
import {
  resolveFunctionDefinitionLoc,
  resolveFunctionReturnType,
} from "./resolveFunctionReturnType";

export type { ModuleBindingMeta };

const extractCallName = (call: CallExpression): string | undefined => {
  const expression = call.getExpression();
  if (expression.isKind(SyntaxKind.Identifier)) {
    return expression.getText();
  }
  return undefined;
};

const unwrapInitializer = (
  initializer: import("ts-morph").Node | undefined
): import("ts-morph").Node | undefined => {
  if (!initializer) {
    return undefined;
  }
  if (
    initializer.isKind(SyntaxKind.AsExpression) ||
    initializer.isKind(SyntaxKind.TypeAssertionExpression) ||
    initializer.isKind(SyntaxKind.ParenthesizedExpression)
  ) {
    return unwrapInitializer(
      initializer.getExpression() as import("ts-morph").Node
    );
  }
  return initializer;
};

const classifyInitializer = (
  initializer: import("ts-morph").Node | undefined
): ModuleBindingMeta["valueKind"] => {
  const unwrapped = unwrapInitializer(initializer);
  if (!unwrapped) {
    return undefined;
  }
  if (unwrapped.isKind(SyntaxKind.CallExpression)) {
    return "call";
  }
  if (unwrapped.isKind(SyntaxKind.ObjectLiteralExpression)) {
    return "object";
  }
  if (unwrapped.isKind(SyntaxKind.ArrayLiteralExpression)) {
    return "array";
  }
  if (
    unwrapped.isKind(SyntaxKind.StringLiteral) ||
    unwrapped.isKind(SyntaxKind.NumericLiteral) ||
    unwrapped.isKind(SyntaxKind.TrueKeyword) ||
    unwrapped.isKind(SyntaxKind.FalseKeyword) ||
    unwrapped.isKind(SyntaxKind.NullKeyword)
  ) {
    return "literal";
  }
  if (unwrapped.isKind(SyntaxKind.Identifier)) {
    return "identifier";
  }
  return undefined;
};

export const analyzeModuleBindings = ({
  filePath,
  imports,
  project,
  rootDir,
  sourceFile,
  tsConfigPath,
}: {
  filePath: string;
  imports: ImportInfo[];
  project?: Project;
  rootDir: string;
  sourceFile: SourceFile;
  tsConfigPath?: string;
}): ModuleBindingMeta[] => {
  const bindings: ModuleBindingMeta[] = [];

  for (const statement of sourceFile.getStatements()) {
    if (!statement.isKind(SyntaxKind.VariableStatement)) {
      continue;
    }
    if (!statement.getParent()?.isKind(SyntaxKind.SourceFile)) {
      continue;
    }

    for (const declaration of statement.getDeclarations()) {
      const nameNode = declaration.getNameNode();
      if (!nameNode.isKind(SyntaxKind.Identifier)) {
        continue;
      }

      const name = nameNode.getText();
      const initializer = unwrapInitializer(declaration.getInitializer());
      const valueKind = classifyInitializer(declaration.getInitializer());

      if (!valueKind) {
        continue;
      }

      const binding: ModuleBindingMeta = {
        loc: getSourceLocation(statement, filePath),
        name,
        valueKind,
      };

      if (initializer?.isKind(SyntaxKind.CallExpression)) {
        const callName = extractCallName(initializer);
        if (callName) {
          binding.callFunctionName = callName;
          binding.callExpression = getNodeText(initializer);
          binding.returnType = resolveFunctionReturnType({
            functionName: callName,
            imports,
            project,
            sourceFile,
          });
          binding.callDefinitionLoc = resolveFunctionDefinitionLoc({
            functionName: callName,
            imports,
            project,
            sourceFile,
          });
          binding.argumentCallTree = buildArgumentCallTreeForCall({
            call: initializer,
            filePath,
            imports,
            project,
            rootDir,
            tsConfigPath,
          });
        }
      }

      bindings.push(binding);
    }
  }

  return bindings;
};
