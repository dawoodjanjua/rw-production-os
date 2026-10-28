"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [["/settings", "Company & invoices"], ["/settings/shifts", "Shifts & rates"], ["/settings/reminders", "Reminders"], ["/settings/messaging", "WhatsApp"], ["/settings/team", "Team"]];

export function SettingsTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map(([h, l]) => <Link key={h} href={h} className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${path === h ? "border-brand font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}>{l}</Link>)}
    </div>
  );
}
