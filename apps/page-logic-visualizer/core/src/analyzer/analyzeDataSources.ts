import type { ImportInfo } from "../types";
import type { StoreLibrary } from "../types";

const REDUX_HOOKS = new Set([
  "useSelector",
  "useAppSelector",
  "useDispatch",
  "useAppDispatch",
  "useStore",
]);

const MOBX_HOOKS = new Set([
  "useObserver",
  "useLocalObservable",
  "useAsObservableSource",
]);

const inferStoreLibrary = (
  hookName: string,
  importInfo: ImportInfo | undefined,
  moduleSpecifier: string | undefined
): StoreLibrary | undefined => {
  const module = (
    importInfo?.moduleSpecifier ??
    moduleSpecifier ??
    ""
  ).toLowerCase();

  if (
    module.includes("react-redux") ||
    module.includes("@reduxjs/toolkit") ||
    REDUX_HOOKS.has(hookName)
  ) {
    return "redux";
  }

  if (module.includes("zustand")) {
    return "zustand";
  }
  if (hookName === "useStore" && module.includes("zustand")) {
    return "zustand";
  }

  if (
    module.includes("mobx") ||
    MOBX_HOOKS.has(hookName) ||
    hookName === "observer"
  ) {
    return "mobx";
  }

  if (/store/i.test(module) || hookName.endsWith("Store")) {
    return "custom";
  }

  return undefined;
};

export const isContextHook = (hookName: string): boolean =>
  hookName === "useContext";

export const isStoreHook = (
  hookName: string,
  importInfo: ImportInfo | undefined
): boolean => {
  if (REDUX_HOOKS.has(hookName) || MOBX_HOOKS.has(hookName)) {
    return true;
  }
  if (hookName === "useStore") {
    const module = (importInfo?.moduleSpecifier ?? "").toLowerCase();
    return module.includes("zustand") || module.includes("react-redux");
  }
  const library = inferStoreLibrary(
    hookName,
    importInfo,
    importInfo?.moduleSpecifier
  );
  return library !== undefined;
};

export const isStoreBackedLocal = (
  _variableName: string,
  sourceHook: string | undefined
): boolean => {
  if (!sourceHook) {
    return false;
  }
  return isStoreHook(sourceHook) || /store/i.test(sourceHook);
};

export const resolveStoreLibrary = (
  hookName: string,
  importInfo: ImportInfo | undefined
): StoreLibrary =>
  inferStoreLibrary(hookName, importInfo, importInfo?.moduleSpecifier) ??
  "unknown";

export const extractContextName = (argumentExpressions: string[]): string => {
  const first = argumentExpressions[0]?.trim();
  if (!first) {
    return "Context";
  }
  return first.replace(/Context$/i, "") || first;
};

export const extractStoreName = (
  hookName: string,
  argumentExpressions: string[],
  importInfo: ImportInfo | undefined
): string => {
  const selector = argumentExpressions[0]?.trim();
  if (selector && selector.length < 80) {
    return selector;
  }
  if (importInfo?.moduleSpecifier) {
    const segment = importInfo.moduleSpecifier.split("/").pop();
    if (segment) {
      return segment.replace(/\.(ts|tsx|js|jsx)$/, "");
    }
  }
  return hookName.replace(/^use/, "") || "Store";
};
