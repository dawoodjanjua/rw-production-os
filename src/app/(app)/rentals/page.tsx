import Link from "next/link";
import { Plus } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { dateTime, money } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui";

export const metadata = { title: "Rentals" };

const TABS = [
  ["open", "Open"], ["overdue", "Overdue"], ["reserved", "Reserved"], ["returned", "Returned"], ["all", "All"],
] as const;

export default async function RentalsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const ctx = await requireTenant();
  const { tab = "open", q = "" } = await searchParams;
  const tz = ctx.settings.timezone, cur = ctx.settings.currency;
  let query = ctx.supabase.from("v_rentals").select("*").eq("tenant_id", ctx.tenantId).limit(200);
  if (tab === "open") query = query.in("status", ["dispatched", "partially_returned"]).order("expected_return_at");
  else if (tab === "overdue") query = query.eq("is_overdue", true).order("expected_return_at");
  else if (tab === "reserved") query = query.eq("status", "reserved").order("start_at");
  else if (tab === "returned") query = query.in("status", ["returned", "closed"]).order("returned_at", { ascending: false });
  else query = query.order("created_at", { ascending: false });
  const term = q.replace(/[%,()]/g, " ").trim();
  if (term) query = query.or(`reference.ilike.%${term}%,project_name.ilike.%${term}%,client_name.ilike.%${term}%`);
  const { data: rentals } = await query;

  return (
    <>
      <PageHeader title="Rentals" subtitle="Reservations, dispatches and returns."
        actions={<><Link href="/returns" className="btn-secondary">Record return</Link><Link href="/rentals/new" className="btn-primary"><Plus size={16} />New dispatch</Link></>} />
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1">
            {TABS.map(([k, l]) => <Link key={k} href={`?tab=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? "bg-brand text-white" : "text-muted hover:bg-bg"}`}>{l}</Link>)}
          </div>
          <form className="flex gap-2"><input type="hidden" name="tab" value={tab} /><input name="q" defaultValue={q} placeholder="Reference, client or project" className="input sm:w-64" /><button className="btn-secondary">Search</button></form>
        </div>
        {rentals?.length ? (
          <Table head={<tr><th className="th">Rental</th><th className="th">Client / project</th><th className="th">Dispatched</th><th className="th">Return</th><th className="th text-right">Total</th><th className="th">Status</th></tr>}>
            {rentals.map((r) => (
              <tr key={r.id} className="hover:bg-bg/50">
                <td className="td"><Link href={`/rentals/${r.id}`} className="font-medium hover:underline">{r.reference}</Link><div className="text-xs text-muted">{r.item_count} item(s)</div></td>
                <td className="td">{r.client_name}<div className="text-xs text-muted">{r.project_name ?? ""}</div></td>
                <td className="td text-muted">{dateTime(r.dispatched_at ?? r.start_at, tz)}</td>
                <td className={`td ${r.is_overdue ? "font-medium text-red-700" : "text-muted"}`}>{r.returned_at ? dateTime(r.returned_at, tz) : dateTime(r.expected_return_at, tz)}</td>
                <td className="td text-right tabular-nums">{money(r.total, cur)}</td>
                <td className="td"><Badge status={r.display_status} /></td>
              </tr>
            ))}
          </Table>
        ) : <EmptyState title={tab === "overdue" ? "Nothing overdue" : "No rentals here"} body={tab === "open" ? "Dispatched equipment will appear here until it is returned." : undefined}
              action={tab === "open" && <Link href="/rentals/new" className="btn-primary">New dispatch</Link>} />}
      </Card>
    </>
  );
}
