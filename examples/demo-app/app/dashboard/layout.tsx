interface DashboardLayoutProps {
  children: React.ReactNode;
}

/** Level 3 route — layout wrapper for `/dashboard/*` */
export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <section data-slot="dashboard-layout">
      <nav>Dashboard</nav>
      {children}
    </section>
  );
}
