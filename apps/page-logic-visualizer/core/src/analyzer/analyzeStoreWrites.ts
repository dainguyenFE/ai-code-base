import type { CallExpression, Node, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";

import type {
  SourceLocation,
  StoreWriteContext,
  StoreWriteSite,
} from "../types";
import { getNodeText, getSourceLocation } from "../utils/ast";

export const setterNameForField = (field: string): string =>
  `set${field.charAt(0).toUpperCase()}${field.slice(1)}`;

const calleeMatchesStoreFieldWrite = (
  calleeText: string,
  storeField: string
): boolean => {
  const setter = setterNameForField(storeField);
  if (calleeText === setter) {
    return true;
  }
  if (calleeText.endsWith(`.${setter}`)) {
    return true;
  }
  if (calleeText.endsWith(".setState") || calleeText.endsWith(".set")) {
    return true;
  }
  if (/^dispatch$/.test(calleeText)) {
    return true;
  }
  return false;
};

const inferWriteContext = (node: Node): StoreWriteContext => {
  let current: Node | undefined = node;
  while (current) {
    if (current.isKind(SyntaxKind.JsxAttribute)) {
      const name = current.getNameNode().getText();
      if (/^on[A-Z]/.test(name)) {
        return "event-handler";
      }
    }

    if (current.isKind(SyntaxKind.CallExpression)) {
      const callee = getNodeText(current.getExpression());
      if (callee === "useEffect" || callee.endsWith(".useEffect")) {
        return "effect";
      }
    }

    current = current.getParent();
  }
  return "function";
};

const findEnclosingEffectDeps = (node: Node): string[] | undefined => {
  let current: Node | undefined = node;
  while (current) {
    if (!current.isKind(SyntaxKind.CallExpression)) {
      current = current.getParent();
      continue;
    }
    const callee = getNodeText(current.getExpression());
    if (callee !== "useEffect" && !callee.endsWith(".useEffect")) {
      current = current.getParent();
      continue;
    }
    const depsArg = current.getArguments()[1];
    if (!depsArg?.isKind(SyntaxKind.ArrayLiteralExpression)) {
      return [];
    }
    return depsArg
      .getElements()
      .map((element) => getNodeText(element))
      .filter(Boolean);
  }
  return undefined;
};

const pushWrite = (
  writes: StoreWriteSite[],
  seen: Set<string>,
  site: StoreWriteSite
): void => {
  const key = `${site.filePath}:${site.loc?.startLine ?? 0}:${site.expression}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  writes.push(site);
};

/** Static scan for store-field setter calls inside a component/hook body. */
export const analyzeStoreWritesInBody = ({
  body,
  filePath,
  ownerLabel,
  storeField,
}: {
  body: Node;
  filePath: string;
  ownerLabel: string;
  storeField: string;
}): StoreWriteSite[] => {
  const writes: StoreWriteSite[] = [];
  const seen = new Set<string>();

  body.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.CallExpression)) {
      return;
    }
    const call = node as CallExpression;
    const calleeText = getNodeText(call.getExpression());
    if (!calleeMatchesStoreFieldWrite(calleeText, storeField)) {
      return;
    }

    const context = inferWriteContext(call);
    const loc = getSourceLocation(call, filePath);
    const effectDeps =
      context === "effect" ? findEnclosingEffectDeps(call) : undefined;

    pushWrite(writes, seen, {
      context,
      effectDeps,
      expression: getNodeText(call),
      filePath,
      loc,
      ownerLabel,
      setterName: calleeText.includes(".")
        ? (calleeText.split(".").pop() ?? calleeText)
        : calleeText,
      storeField,
    });
  });

  return writes;
};

/** Effect dependency entries that read a store field (reactive triggers, not writes). */
export const analyzeStoreFieldEffectDeps = ({
  body,
  filePath,
  ownerLabel,
  storeField,
}: {
  body: Node;
  filePath: string;
  ownerLabel: string;
  storeField: string;
}): StoreWriteSite[] => {
  const triggers: StoreWriteSite[] = [];
  const seen = new Set<string>();

  body.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.CallExpression)) {
      return;
    }
    const call = node as CallExpression;
    const callee = getNodeText(call.getExpression());
    if (callee !== "useEffect" && !callee.endsWith(".useEffect")) {
      return;
    }

    const depsArg = call.getArguments()[1];
    if (!depsArg?.isKind(SyntaxKind.ArrayLiteralExpression)) {
      return;
    }

    const deps = depsArg.getElements().map((element) => getNodeText(element));
    if (!deps.includes(storeField)) {
      return;
    }

    const loc = getSourceLocation(call, filePath);
    const key = `${filePath}:${loc.startLine}:deps:${storeField}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    triggers.push({
      context: "effect-deps",
      effectDeps: deps,
      expression: getNodeText(call),
      filePath,
      loc,
      ownerLabel,
      setterName: "useEffect",
      storeField,
    });
  });

  return triggers;
};

export const loadBodyFromSourceFile = (
  sourceFile: SourceFile,
  ownerLabel: string
): Node | undefined => {
  for (const fn of sourceFile.getFunctions()) {
    if (fn.getName() === ownerLabel) {
      return fn.getBody() ?? undefined;
    }
  }
  for (const statement of sourceFile.getVariableStatements()) {
    for (const decl of statement.getDeclarations()) {
      if (decl.getName() !== ownerLabel) {
        continue;
      }
      const initializer = decl.getInitializer();
      if (
        initializer?.isKind(SyntaxKind.ArrowFunction) ||
        initializer?.isKind(SyntaxKind.FunctionExpression)
      ) {
        return initializer.getBody() ?? undefined;
      }
    }
  }
  return sourceFile;
};
