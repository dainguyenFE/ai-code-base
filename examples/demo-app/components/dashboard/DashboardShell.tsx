import { useDashboardData } from "../../hooks/useDashboardData";
import { InfoCard } from "../cards/InfoCard";
import { DashboardStats } from "./DashboardStats";

/** Level 5 — orchestrates cards, stats, and data hook */
export function DashboardShell() {
  const { stats, showDetails, toggleDetails } = useDashboardData();

  return (
    <div data-slot="dashboard-shell">
      <InfoCard title="Dashboard" badge="live" />
      <DashboardStats stats={stats} />
      <button type="button" onClick={toggleDetails}>
        {showDetails ? "Hide details" : "Show details"}
      </button>
      {showDetails ? (
        <p>Loaded {stats.length} metrics from getStats()</p>
      ) : null}
    </div>
  );
}
