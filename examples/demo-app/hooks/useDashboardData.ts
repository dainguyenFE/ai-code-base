import { getStats } from "../lib/dashboard/getStats";
import { useCounter } from "./useCounter";
import { useToggle } from "./useToggle";

/** Level 4 — composes hooks + lib layer */
export function useDashboardData() {
  const stats = getStats();
  const { count, increment, decrement } = useCounter(0);
  const { on: showDetails, toggle: toggleDetails } = useToggle(true);

  return {
    count,
    decrement,
    increment,
    showDetails,
    stats,
    toggleDetails,
  };
}
