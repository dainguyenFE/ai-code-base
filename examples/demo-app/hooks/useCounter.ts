import { useCallback, useState } from "react";

import { useToggle } from "./useToggle";

/** Level 2 — composes another hook + useCallback */
export function useCounter(initial = 0) {
  const [count, setCount] = useState(initial);
  const { on: isLocked, toggle: toggleLock } = useToggle(false);

  const increment = useCallback(() => {
    if (!isLocked) {
      setCount((value) => value + 1);
    }
  }, [isLocked]);

  const decrement = useCallback(() => {
    if (!isLocked) {
      setCount((value) => value - 1);
    }
  }, [isLocked]);

  return { count, decrement, increment, isLocked, toggleLock };
}
