export interface DashboardStat {
  id: string;
  label: string;
  value: number;
}

export function getStats(): DashboardStat[] {
  return [
    { id: "users", label: "Users", value: 128 },
    { id: "posts", label: "Posts", value: 42 },
    { id: "views", label: "Views", value: 9204 },
  ];
}
