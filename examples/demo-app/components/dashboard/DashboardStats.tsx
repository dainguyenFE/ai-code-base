import { useCounter } from "../../hooks/useCounter";
import type { DashboardStat } from "../../lib/dashboard/getStats";
import { StatTile } from "./StatTile";

interface DashboardStatsProps {
  stats: DashboardStat[];
}

/** Level 4 — multiple children + hook */
export function DashboardStats({ stats }: DashboardStatsProps) {
  const { count, increment, decrement, isLocked, toggleLock } = useCounter();

  return (
    <section data-slot="dashboard-stats">
      <div>
        <button type="button" onClick={decrement}>
          -
        </button>
        <span>{count}</span>
        <button type="button" onClick={increment}>
          +
        </button>
        <button type="button" onClick={toggleLock}>
          {isLocked ? "Unlock" : "Lock"}
        </button>
      </div>
      {stats.map((stat) => (
        <StatTile key={stat.id} label={stat.label} value={stat.value} />
      ))}
    </section>
  );
}
