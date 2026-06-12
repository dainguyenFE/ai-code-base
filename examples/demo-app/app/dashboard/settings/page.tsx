"use client";

import { useToggle } from "../../../hooks/useToggle";

/** Level 5 route — nested `/dashboard/settings` + client hook */
export default function SettingsPage() {
  const { on: notifications, toggle } = useToggle(true);

  return (
    <main>
      <h1>Settings</h1>
      <button type="button" onClick={toggle}>
        Notifications: {notifications ? "on" : "off"}
      </button>
    </main>
  );
}
