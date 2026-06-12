import dynamic from "next/dynamic";

const DashboardShell = dynamic(() =>
  import("../../components/dashboard/DashboardShell").then((module) => ({
    default: module.DashboardShell,
  }))
);

/** Level 4 route — `/dashboard` with layout + complex shell */
export default function DashboardPage() {
  return (
    <main>
      <DashboardShell />
    </main>
  );
}
