import type {
  FunctionDeclaration,
  ParameterDeclaration,
  SourceFile,
  VariableDeclaration,
} from "ts-morph";
import { SyntaxKind } from "ts-morph";

export interface MainComponent {
  name: string;
  body: import("ts-morph").Node | undefined;
  isAsync: boolean;
  propNames?: string[];
}

const extractParamNames = (parameters: ParameterDeclaration[]): string[] =>
  parameters.flatMap((param) => {
    const nameNode = param.getNameNode();
    if (nameNode.isKind(SyntaxKind.Identifier)) {
      return [nameNode.getText()];
    }
    if (nameNode.isKind(SyntaxKind.ObjectBindingPattern)) {
      return nameNode.getElements().map((element) => element.getName());
    }
    return [];
  });

const componentFromFunction = (fn: FunctionDeclaration): MainComponent => ({
  body: fn.getBody(),
  isAsync: fn.isAsync(),
  name: fn.getName() ?? "Component",
  propNames: extractParamNames(fn.getParameters()),
});

export const findMainComponent = (
  sourceFile: SourceFile
): MainComponent | undefined => {
  const defaultExportSymbol = sourceFile.getDefaultExportSymbol();
  if (!defaultExportSymbol) {
    return undefined;
  }

  const declarations = defaultExportSymbol.getDeclarations();
  for (const declaration of declarations) {
    if (declaration.isKind(SyntaxKind.FunctionDeclaration)) {
      const fn = declaration as FunctionDeclaration;
      return componentFromFunction(fn);
    }

    if (declaration.isKind(SyntaxKind.VariableDeclaration)) {
      const variable = declaration as VariableDeclaration;
      const initializer = variable.getInitializer();
      if (
        initializer?.isKind(SyntaxKind.ArrowFunction) ||
        initializer?.isKind(SyntaxKind.FunctionExpression)
      ) {
        return {
          body: initializer.getBody(),
          isAsync: initializer.isAsync(),
          name: variable.getName(),
          propNames: extractParamNames(initializer.getParameters()),
        };
      }
    }
  }

  const defaultExport = sourceFile.getExportAssignment(
    (assignment) => !assignment.isExportEquals()
  );
  if (defaultExport) {
    const expression = defaultExport.getExpression();
    if (
      expression.isKind(SyntaxKind.ArrowFunction) ||
      expression.isKind(SyntaxKind.FunctionExpression)
    ) {
      return {
        body: expression.getBody(),
        isAsync: expression.isAsync(),
        name: "Page",
        propNames: extractParamNames(expression.getParameters()),
      };
    }
    if (expression.isKind(SyntaxKind.Identifier)) {
      const identifierName = expression.getText();
      const fn = sourceFile
        .getFunctions()
        .find((func) => func.getName() === identifierName);
      if (fn) {
        return componentFromFunction(fn);
      }
    }
  }

  const functions = sourceFile.getFunctions();
  for (const fn of functions) {
    if (fn.isDefaultExport()) {
      return componentFromFunction(fn);
    }
  }

  return undefined;
};

export const findComponentByName = (
  sourceFile: SourceFile,
  componentName: string
): MainComponent | undefined => {
  for (const fn of sourceFile.getFunctions()) {
    if (fn.getName() === componentName) {
      return componentFromFunction(fn);
    }
  }

  for (const variable of sourceFile.getVariableDeclarations()) {
    if (variable.getName() !== componentName) {
      continue;
    }
    const initializer = variable.getInitializer();
    if (
      initializer?.isKind(SyntaxKind.ArrowFunction) ||
      initializer?.isKind(SyntaxKind.FunctionExpression)
    ) {
      return {
        body: initializer.getBody(),
        isAsync: initializer.isAsync(),
        name: componentName,
        propNames: extractParamNames(initializer.getParameters()),
      };
    }
  }

  return undefined;
};
