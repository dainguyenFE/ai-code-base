import { useCallback, useState } from "react";

/** Level 1 — simple hook (useState only) */
export function useToggle(initial = false) {
  const [on, setOn] = useState(initial);
  const toggle = useCallback(() => setOn((value) => !value), []);

  return { on, setOn, toggle };
}
