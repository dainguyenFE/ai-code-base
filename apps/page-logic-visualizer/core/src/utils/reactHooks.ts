const REACT_BUILTIN_HOOKS = new Set([
  "useCallback",
  "useContext",
  "useDebugValue",
  "useDeferredValue",
  "useEffect",
  "useId",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
]);

export const isReactBuiltInHook = (hookName: string): boolean =>
  REACT_BUILTIN_HOOKS.has(hookName);

export const isCustomHookName = (hookName: string): boolean =>
  /^use[A-Z]/.test(hookName) && !isReactBuiltInHook(hookName);
