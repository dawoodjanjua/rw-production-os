import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_LABEL } from "@/lib/format";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </div>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default", href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "warn" | "danger"; href?: string }) {
  const body = (
    <div className="card h-full p-4 transition-colors hover:border-brand/30">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight sm:text-[28px]">{value}</div>
      {hint && <div className={`mt-1 text-xs ${tone === "danger" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-muted"}`}>{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  gray: "bg-stone-100 text-stone-600 ring-stone-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
};
const STATUS_TONE: Record<string, keyof typeof TONES> = {
  available: "green", returned: "green", paid: "green", closed: "gray", delivered: "green", read: "green", sent: "green",
  dispatched: "blue", issued: "blue", reserved: "violet", scheduled: "violet", queued: "violet", processing: "violet",
  partially_returned: "amber", partially_paid: "amber", maintenance: "amber", dry_run: "amber", opened: "amber", prepared: "amber", skipped: "gray",
  overdue: "red", damaged: "red", missing: "red", failed: "red",
  cancelled: "gray", void: "gray", draft: "gray", retired: "gray",
};

export function Badge({ status, children, tone }: { status?: string; children?: ReactNode; tone?: keyof typeof TONES }) {
  const t = tone ?? (status ? STATUS_TONE[status] : undefined) ?? "gray";
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[t]}`}>
      {children ?? (status ? STATUS_LABEL[status] ?? status : "")}
    </span>
  );
}

export function Table({ head, children, empty }: { head: ReactNode; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-line bg-bg/60">{head}</thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="text-sm font-semibold">{title}</div>
      {body && <p className="mt-1 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "ok"; children: ReactNode }) {
  const c = { info: "border-sky-200 bg-sky-50 text-sky-900", warn: "border-amber-200 bg-amber-50 text-amber-900", danger: "border-red-200 bg-red-50 text-red-800", ok: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${c}`}>{children}</div>;
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="mt-0.5">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SearchBox({ placeholder, defaultValue, children }: { placeholder: string; defaultValue?: string; children?: ReactNode }) {
  return (
    <form className="flex flex-col gap-2 sm:flex-row">
      <input name="q" defaultValue={defaultValue} placeholder={placeholder} className="input sm:max-w-sm" />
      {children}
      <button className="btn-secondary">Search</button>
    </form>
  );
}
