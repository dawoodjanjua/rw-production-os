import Link from "next/link";
import { requireTenant } from "@/lib/auth";
import { date, dateTime, money } from "@/lib/format";
import { PERIODS, periodRange } from "@/lib/periods";
import { Badge, Card, EmptyState, PageHeader, Stat, Table } from "@/components/ui";

export const metadata = { title: "Reports" };
const REPORTS = [["availability", "Equipment availability"], ["rentals", "Active & overdue rentals"], ["revenue", "Revenue"], ["outstanding", "Outstanding balances"], ["history", "Equipment rental history"]] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ r?: string; period?: string; from?: string; to?: string }> }) {
  const ctx = await requireTenant();
  const sp = await searchParams;
  const r = sp.r ?? "availability";
  const tz = ctx.settings.timezone, cur = ctx.settings.currency, t = ctx.tenantId;
  const period = sp.period ?? "30d";
  const range = periodRange(period, tz, sp.from, sp.to);

  let body: React.ReactNode = null;
  if (r === "availability") {
    const { data } = await ctx.supabase.from("v_equipment_availability").select("*").eq("tenant_id", t).is("archived_at", null).order("category_name").order("name");
    body = data?.length ? (
      <Table head={<tr><th className="th">Item</th><th className="th">Category</th><th className="th text-right">Total</th><th className="th text-right">Available</th><th className="th text-right">Reserved</th><th className="th text-right">On rent</th><th className="th text-right">Out of service</th></tr>}>
        {data.map((i) => <tr key={i.id}><td className="td"><Link className="link" href={`/equipment/${i.id}`}>{i.name}</Link><div className="text-xs text-muted">{i.code}</div></td><td className="td text-muted">{i.category_name ?? "—"}</td>
          <td className="td text-right tabular-nums">{i.quantity_total}</td><td className="td text-right font-medium tabular-nums">{i.qty_available}</td><td className="td text-right tabular-nums">{i.qty_reserved}</td>
          <td className="td text-right tabular-nums">{i.qty_out}</td><td className={`td text-right tabular-nums ${i.qty_unavailable ? "text-amber-700" : ""}`}>{i.qty_unavailable}</td></tr>)}
      </Table>
    ) : <EmptyState title="No equipment" />;
  } else if (r === "rentals") {
    const { data } = await ctx.supabase.from("v_rentals").select("*").eq("tenant_id", t).in("status", ["reserved", "dispatched", "partially_returned"]).order("is_overdue", { ascending: false }).order("expected_return_at");
    const overdue = (data ?? []).filter((x) => x.is_overdue);
    body = <>
      <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
        <Stat label="Open rentals" value={data?.length ?? 0} /><Stat label="Overdue" value={overdue.length} tone={overdue.length ? "danger" : "default"} />
        <Stat label="Units out" value={(data ?? []).filter((x) => x.status !== "reserved").reduce((s, x) => s + x.qty_outstanding, 0)} />
        <Stat label="Open rental value" value={money((data ?? []).reduce((s, x) => s + Number(x.total), 0), cur)} />
      </div>
      {data?.length ? <Table head={<tr><th className="th">Rental</th><th className="th">Client</th><th className="th">Return deadline</th><th className="th text-right">Units out</th><th className="th text-right">Total</th><th className="th">Status</th></tr>}>
        {data.map((x) => <tr key={x.id}><td className="td"><Link className="link" href={`/rentals/${x.id}`}>{x.reference}</Link></td><td className="td">{x.client_name}<div className="text-xs text-muted">{x.project_name}</div></td>
          <td className={`td ${x.is_overdue ? "font-medium text-red-700" : ""}`}>{dateTime(x.expected_return_at, tz)}</td><td className="td text-right tabular-nums">{x.qty_outstanding}</td>
          <td className="td text-right tabular-nums">{money(x.total, cur)}</td><td className="td"><Badge status={x.display_status} /></td></tr>)}
      </Table> : <EmptyState title="No open rentals" />}
    </>;
  } else if (r === "revenue") {
    const [{ data: pays }, { data: billed }] = await Promise.all([
      ctx.supabase.from("payments").select("amount,paid_at,method,invoices(number,clients(name))").eq("tenant_id", t).gte("paid_at", range.from).lt("paid_at", range.to).order("paid_at", { ascending: false }),
      ctx.supabase.from("invoices").select("total").eq("tenant_id", t).in("status", ["issued", "partially_paid", "paid"]).gte("issued_at", range.from).lt("issued_at", range.to),
    ]);
    const received = (pays ?? []).reduce((s, p) => s + Number(p.amount), 0);
    const byMethod = new Map<string, number>();
    pays?.forEach((p) => byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + Number(p.amount)));
    body = <>
      <form className="flex flex-wrap items-end gap-2 border-b border-line p-4">
        <input type="hidden" name="r" value="revenue" />
        <label><span className="label">Period</span><select name="period" defaultValue={period} className="input">{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}<option value="custom">Custom range</option></select></label>
        <label><span className="label">From</span><input type="date" name="from" defaultValue={sp.from} className="input" /></label>
        <label><span className="label">To</span><input type="date" name="to" defaultValue={sp.to} className="input" /></label>
        <button className="btn-secondary">Apply</button>
      </form>
      <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
        <Stat label="Payments received" value={money(received, cur)} hint={range.label} />
        <Stat label="Invoiced (issued)" value={money((billed ?? []).reduce((s, i) => s + Number(i.total), 0), cur)} hint={`${billed?.length ?? 0} invoice(s)`} />
        {[...byMethod.entries()].slice(0, 2).map(([k, v]) => <Stat key={k} label={k.replace(/_/g, " ")} value={money(v, cur)} />)}
      </div>
      {pays?.length ? <Table head={<tr><th className="th">Date</th><th className="th">Invoice</th><th className="th">Client</th><th className="th">Method</th><th className="th text-right">Amount</th></tr>}>
        {pays.map((p, i) => { const inv = p.invoices as unknown as { number: string; clients: { name: string } }; return (
          <tr key={i}><td className="td text-muted">{dateTime(p.paid_at, tz)}</td><td className="td">{inv?.number}</td><td className="td">{inv?.clients?.name}</td><td className="td capitalize text-muted">{p.method.replace(/_/g, " ")}</td><td className="td text-right tabular-nums">{money(p.amount, cur)}</td></tr>); })}
      </Table> : <EmptyState title="No payments in this period" />}
    </>;
  } else if (r === "outstanding") {
    const { data } = await ctx.supabase.from("v_invoices").select("*").eq("tenant_id", t).in("status", ["issued", "partially_paid"]).order("due_date");
    const byClient = new Map<string, { name: string; id: string; balance: number; overdue: number; count: number }>();
    data?.forEach((i) => {
      const c = byClient.get(i.client_id) ?? { name: i.client_name, id: i.client_id, balance: 0, overdue: 0, count: 0 };
      c.balance += Number(i.balance); c.count++; if (i.is_overdue) c.overdue += Number(i.balance);
      byClient.set(i.client_id, c);
    });
    const rows = [...byClient.values()].sort((a, b) => b.balance - a.balance);
    body = rows.length ? <>
      <Table head={<tr><th className="th">Client</th><th className="th text-right">Invoices</th><th className="th text-right">Overdue</th><th className="th text-right">Outstanding</th></tr>}>
        {rows.map((c) => <tr key={c.id}><td className="td"><Link className="link" href={`/clients/${c.id}`}>{c.name}</Link></td><td className="td text-right">{c.count}</td><td className={`td text-right tabular-nums ${c.overdue ? "text-red-700" : ""}`}>{money(c.overdue, cur)}</td><td className="td text-right font-medium tabular-nums">{money(c.balance, cur)}</td></tr>)}
        <tr className="bg-bg/60 font-semibold"><td className="td">Total</td><td className="td text-right">{data?.length}</td><td className="td text-right tabular-nums">{money(rows.reduce((s, c) => s + c.overdue, 0), cur)}</td><td className="td text-right tabular-nums">{money(rows.reduce((s, c) => s + c.balance, 0), cur)}</td></tr>
      </Table>
      <div className="border-t border-line p-4 text-sm font-medium">Invoices</div>
      <Table head={<tr><th className="th">Invoice</th><th className="th">Client</th><th className="th">Due</th><th className="th text-right">Balance</th><th className="th">Status</th></tr>}>
        {data!.map((i) => <tr key={i.id}><td className="td"><Link className="link" href={`/invoices/${i.id}`}>{i.number}</Link></td><td className="td">{i.client_name}</td><td className="td">{date(i.due_date)}</td><td className="td text-right tabular-nums">{money(i.balance, cur)}</td><td className="td"><Badge status={i.display_status} /></td></tr>)}
      </Table>
    </> : <EmptyState title="No outstanding balances" />;
  } else if (r === "history") {
    const { data } = await ctx.supabase.from("rental_items").select("item_id,description,quantity,line_total,qty_damaged,qty_missing,rentals!inner(status,start_at)")
      .eq("tenant_id", t).neq("rentals.status", "cancelled").gte("rentals.start_at", range.from).lt("rentals.start_at", range.to);
    const agg = new Map<string, { name: string; rentals: number; units: number; revenue: number; damaged: number; missing: number }>();
    data?.forEach((l) => {
      const a = agg.get(l.item_id) ?? { name: l.description, rentals: 0, units: 0, revenue: 0, damaged: 0, missing: 0 };
      a.rentals++; a.units += l.quantity; a.revenue += Number(l.line_total); a.damaged += l.qty_damaged; a.missing += l.qty_missing;
      agg.set(l.item_id, a);
    });
    const rows = [...agg.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
    body = <>
      <form className="flex flex-wrap items-end gap-2 border-b border-line p-4"><input type="hidden" name="r" value="history" />
        <label><span className="label">Period (by dispatch date)</span><select name="period" defaultValue={period} className="input">{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><button className="btn-secondary">Apply</button></form>
      {rows.length ? <Table head={<tr><th className="th">Equipment</th><th className="th text-right">Times rented</th><th className="th text-right">Units</th><th className="th text-right">Damaged</th><th className="th text-right">Missing</th><th className="th text-right">Rental value</th></tr>}>
        {rows.map(([id, a]) => <tr key={id}><td className="td"><Link className="link" href={`/equipment/${id}`}>{a.name}</Link></td><td className="td text-right">{a.rentals}</td><td className="td text-right">{a.units}</td><td className="td text-right">{a.damaged}</td><td className="td text-right">{a.missing}</td><td className="td text-right tabular-nums">{money(a.revenue, cur)}</td></tr>)}
      </Table> : <EmptyState title="No rentals in this period" />}
    </>;
  }

  return (
    <>
      <PageHeader title="Reports" subtitle="Simple, accurate operational reports from your live records." />
      <div className="mb-4 flex flex-wrap gap-1">
        {REPORTS.map(([k, l]) => <Link key={k} href={`?r=${k}`} className={`rounded-lg px-3 py-1.5 text-sm ${r === k ? "bg-brand text-white" : "bg-white text-muted ring-1 ring-line hover:text-ink"}`}>{l}</Link>)}
      </div>
      <Card padded={false}>{body}</Card>
    </>
  );
}
