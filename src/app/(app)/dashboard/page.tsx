import Link from "next/link";
import { FilePlus2, PackagePlus, Truck, Undo2 } from "lucide-react";
import { requireTenant, roleAtLeast } from "@/lib/auth";
import { compactMoney, dateTime, fromLocalInput, money, time, todayInTz } from "@/lib/format";
import { PERIODS, periodRange } from "@/lib/periods";
import { Badge, Card, EmptyState, PageHeader, Stat, Table } from "@/components/ui";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const ctx = await requireTenant();
  const { period = "30d" } = await searchParams;
  const tz = ctx.settings.timezone, cur = ctx.settings.currency;
  const today = todayInTz(tz);
  const todayStart = fromLocalInput(`${today}T00:00`, tz);
  const tomorrowStart = new Date(new Date(todayStart).getTime() + 86400000).toISOString();
  const range = periodRange(period, tz);
  const t = ctx.tenantId;

  const [{ data: equipment }, { data: open }, { data: unpaid }, { data: payments }, { data: events }, { count: reservedCount }] = await Promise.all([
    ctx.supabase.from("v_equipment_availability").select("quantity_total,qty_available,qty_out,qty_reserved,qty_unavailable,is_kit").eq("tenant_id", t).is("archived_at", null),
    ctx.supabase.from("v_rentals").select("id,reference,client_name,project_name,expected_return_at,is_overdue,display_status,qty_outstanding").eq("tenant_id", t).in("status", ["dispatched", "partially_returned"]).order("expected_return_at"),
    ctx.supabase.from("v_invoices").select("balance,is_overdue").eq("tenant_id", t).in("status", ["issued", "partially_paid"]),
    ctx.supabase.from("payments").select("amount").eq("tenant_id", t).gte("paid_at", range.from).lt("paid_at", range.to),
    ctx.supabase.from("rental_events").select("id,event_type,occurred_at,rental_id,rentals(reference,clients(name))").eq("tenant_id", t).in("event_type", ["dispatched", "returned", "partial_return"]).order("occurred_at", { ascending: false }).limit(8),
    ctx.supabase.from("v_rentals").select("id", { count: "exact", head: true }).eq("tenant_id", t).eq("status", "reserved"),
  ]);

  const eq = equipment ?? [];
  const units = eq.reduce((s, i) => s + i.quantity_total, 0);
  const available = eq.reduce((s, i) => s + i.qty_available, 0);
  const out = eq.reduce((s, i) => s + i.qty_out, 0);
  const kits = eq.filter((i) => i.is_kit).length;
  const openRentals = open ?? [];
  const overdue = openRentals.filter((r) => r.is_overdue);
  const dueToday = openRentals.filter((r) => !r.is_overdue && r.expected_return_at >= todayStart && r.expected_return_at < tomorrowStart);
  const outstanding = (unpaid ?? []).reduce((s, i) => s + Number(i.balance), 0);
  const revenue = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const isNew = eq.length === 0;
  const canManage = roleAtLeast(ctx.role, "manager");

  const quick = [
    { href: "/rentals/new", label: "New dispatch", icon: Truck, show: true },
    { href: "/returns", label: "Record return", icon: Undo2, show: true },
    { href: "/invoices/new", label: "Create invoice", icon: FilePlus2, show: canManage },
    { href: "/equipment/new", label: "Add equipment", icon: PackagePlus, show: canManage },
  ].filter((q) => q.show);

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Monitor equipment, rentals and receivables · ${new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date())}`}
        actions={<Link href="/rentals/new" className="btn-primary"><Truck size={16} />New dispatch</Link>} />

      {isNew && (
        <div className="card mb-6 p-5">
          <h2 className="text-base font-semibold">Welcome to {ctx.settings.company_name}</h2>
          <p className="mt-1 text-sm text-muted">Set up your workspace in a few steps:</p>
          <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {[["/settings", "1. Add your logo, contact details and payment instructions"], ["/settings/shifts", "2. Check your shift times and rates"], ["/equipment/new", "3. Add your equipment"], ["/clients/new", "4. Add your first client"]].map(([h, l]) => (
              <li key={h}><Link href={h} className="block rounded-lg border border-line p-3 hover:border-brand/40 hover:bg-bg">{l}</Link></li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available gear" value={available} hint={`of ${units} units · ${eq.length} items${kits ? ` · ${kits} kits` : ""}`} href="/equipment" />
        <Stat label="On rent" value={out} hint={`${openRentals.length} open rental(s) · ${dueToday.length} due today`} href="/rentals?tab=open" />
        <Stat label="Overdue" value={overdue.length} hint={overdue.length ? "Needs follow-up" : "All on time"} tone={overdue.length ? "danger" : "default"} href="/rentals?tab=overdue" />
        <Stat label="Outstanding" value={compactMoney(outstanding, cur)} hint={`${unpaid?.length ?? 0} unpaid invoice(s)`} href="/invoices?tab=unpaid" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Upcoming returns" actions={<Link href="/rentals?tab=open" className="text-xs link">All open rentals</Link>} padded={false}>
            {openRentals.length ? (<>
              <ul className="divide-y divide-line sm:hidden">
                {openRentals.slice(0, 8).map((r) => (
                  <li key={r.id}><Link href={`/rentals/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span><span className="block text-sm font-medium">{r.client_name}</span><span className="text-xs text-muted">{r.reference}{r.project_name ? ` · ${r.project_name}` : ""}</span></span>
                    <span className="text-right"><span className={`block text-xs ${r.is_overdue ? "font-medium text-red-700" : "text-muted"}`}>{r.expected_return_at >= todayStart && r.expected_return_at < tomorrowStart ? `Today ${time(r.expected_return_at, tz)}` : dateTime(r.expected_return_at, tz)}</span><Badge status={r.display_status} /></span>
                  </Link></li>
                ))}
              </ul>
              <div className="hidden sm:block"><Table head={<tr><th className="th">Rental</th><th className="th">Client / project</th><th className="th">Return</th><th className="th text-right">Out</th><th className="th">Status</th></tr>}>
                {openRentals.slice(0, 8).map((r) => (
                  <tr key={r.id} className="hover:bg-bg/50">
                    <td className="td"><Link href={`/rentals/${r.id}`} className="font-medium hover:underline">{r.reference}</Link></td>
                    <td className="td">{r.client_name}<div className="text-xs text-muted">{r.project_name}</div></td>
                    <td className={`td ${r.is_overdue ? "font-medium text-red-700" : ""}`}>{r.expected_return_at >= todayStart && r.expected_return_at < tomorrowStart ? `Today ${time(r.expected_return_at, tz)}` : dateTime(r.expected_return_at, tz)}</td>
                    <td className="td text-right tabular-nums">{r.qty_outstanding}</td>
                    <td className="td"><Badge status={r.display_status} /></td>
                  </tr>
                ))}
              </Table></div>
            </>) : <EmptyState title="Nothing is out on rent" body="Dispatched rentals and their return deadlines will appear here." />}
          </Card>

          <Card title="Recent dispatches & returns" padded={false}>
            {events?.length ? (
              <ul className="divide-y divide-line">
                {events.map((e) => {
                  const r = e.rentals as unknown as { reference: string; clients: { name: string } } | null;
                  return (
                    <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <span><Badge status={e.event_type === "dispatched" ? "dispatched" : e.event_type === "returned" ? "returned" : "partially_returned"}>{e.event_type === "dispatched" ? "Dispatched" : e.event_type === "returned" ? "Returned" : "Partial return"}</Badge>{" "}
                        <Link href={`/rentals/${e.rental_id}`} className="font-medium hover:underline">{r?.reference}</Link> <span className="text-muted">· {r?.clients?.name}</span></span>
                      <span className="text-xs text-muted">{dateTime(e.occurred_at, tz)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : <EmptyState title="No activity yet" />}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Quick actions">
            <div className="grid gap-2">
              {quick.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-sm font-medium hover:border-brand/40 hover:bg-bg"><Icon size={16} className="text-brand" />{label}</Link>
              ))}
            </div>
          </Card>
          <Card title="Revenue received" actions={
            <form className="flex"><select name="period" defaultValue={period} className="input py-1 text-xs" aria-label="Period">{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><button className="btn-ghost px-2 text-xs">Go</button></form>
          }>
            <div className="text-2xl font-semibold tabular-nums">{money(revenue, cur)}</div>
            <div className="mt-1 text-xs text-muted">{range.label} · {payments?.length ?? 0} payment(s)</div>
            <Link href={`/reports?period=${period}`} className="mt-3 inline-block text-xs link">Revenue report →</Link>
          </Card>
          <Card title="At a glance">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Reservations waiting dispatch</dt><dd className="tabular-nums">{reservedCount ?? 0}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Units reserved</dt><dd className="tabular-nums">{eq.reduce((s, i) => s + i.qty_reserved, 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Units out of service</dt><dd className="tabular-nums">{eq.reduce((s, i) => s + i.qty_unavailable, 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Overdue invoices</dt><dd className="tabular-nums">{(unpaid ?? []).filter((i) => i.is_overdue).length}</dd></div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
