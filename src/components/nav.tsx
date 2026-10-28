"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, Package, Truck, Undo2, FileText, Users, Building2, BarChart3, BellRing, Settings, Shield, Menu, X,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/equipment", label: "Equipment", icon: Package },
  { href: "/rentals", label: "Rentals", icon: Truck },
  { href: "/returns", label: "Returns", icon: Undo2 },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/suppliers", label: "Suppliers", icon: Building2 },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/reminders", label: "Reminders", icon: BellRing },
  { href: "/settings", label: "Settings", icon: Settings },
];
const MOBILE = [NAV[0], NAV[1], NAV[2], NAV[4]];

type Brand = { company: string; logoUrl: string | null; tagline: string | null };

function BrandMark({ brand }: { brand: Brand }) {
  return (
    <div className="flex items-center gap-3">
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt="" className="h-9 w-9 rounded-lg bg-white object-contain p-0.5" />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 text-xs font-bold text-white">
          {brand.company.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-white">{brand.company}</div>
        <div className="truncate text-[10px] uppercase tracking-wider text-white/60">{brand.tagline || "Production OS"}</div>
      </div>
    </div>
  );
}

export function Sidebar({ brand, isAdmin, userEmail, role, workspaces, activeTenant, switchAction }: {
  brand: Brand; isAdmin: boolean; userEmail: string; role: string;
  workspaces: { id: string; name: string }[]; activeTenant: string; switchAction: (fd: FormData) => Promise<void>;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => path === href || path.startsWith(href + "/");

  const links = (
    <nav className="flex-1 space-y-0.5 px-3">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} onClick={() => setOpen(false)}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${active(href) ? "bg-white/12 font-medium text-white" : "text-white/70 hover:bg-white/6 hover:text-white"}`}>
          <Icon size={17} strokeWidth={1.8} />{label}
        </Link>
      ))}
      {isAdmin && (
        <Link href="/admin" className="mt-3 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/6 hover:text-white">
          <Shield size={17} strokeWidth={1.8} />Platform admin
        </Link>
      )}
    </nav>
  );

  const footer = (
    <div className="border-t border-white/10 p-4 text-xs text-white/60">
      {workspaces.length > 1 && (
        <form action={switchAction} className="mb-3">
          <select name="tenant" defaultValue={activeTenant} onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="w-full rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-xs text-white">
            {workspaces.map((w) => <option key={w.id} value={w.id} className="text-ink">{w.name}</option>)}
          </select>
        </form>
      )}
      <div className="truncate text-white/80">{userEmail}</div>
      <div className="mt-0.5 capitalize">{role}</div>
      <form action="/auth/signout" method="post" className="mt-2"><button className="text-white/70 underline-offset-2 hover:text-white hover:underline">Sign out</button></form>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-[color-mix(in_srgb,var(--brand)_55%,#0d1310)] lg:flex">
        <div className="px-5 py-5"><BrandMark brand={brand} /></div>
        {links}
        {footer}
      </aside>

      {/* Mobile top bar */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-line bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-[10px] font-bold text-white">
            {brand.company.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <span className="text-sm font-semibold">{brand.company}</span>
        </div>
        <button onClick={() => setOpen(true)} className="btn-ghost px-2" aria-label="Open menu"><Menu size={20} /></button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-72 flex-col bg-[color-mix(in_srgb,var(--brand)_55%,#0d1310)]">
            <div className="flex items-center justify-between px-5 py-5">
              <BrandMark brand={brand} />
              <button onClick={() => setOpen(false)} className="text-white/70" aria-label="Close menu"><X size={20} /></button>
            </div>
            {links}
            {footer}
          </div>
        </div>
      )}

      {/* Mobile bottom navigation */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-white lg:hidden">
        {MOBILE.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${active(href) ? "text-brand" : "text-muted"}`}>
            <Icon size={19} strokeWidth={1.8} />{label === "Equipment" ? "Gear" : label === "Rentals" ? "Rent" : label === "Invoices" ? "Bills" : "Home"}
          </Link>
        ))}
      </nav>
    </>
  );
}
