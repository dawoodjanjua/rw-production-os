import Link from "next/link";
import { requireTenant } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui";

export const metadata = { title: "Returns" };

/** Fast return lookup: by rental reference, client, project, or equipment / asset code. */
export default async function ReturnsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireTenant();
  const { q = "" } = await searchParams;
  const term = q.replace(/[%,()]/g, " ").trim();
  let query = ctx.supabase.from("v_rentals").select("*").eq("tenant_id", ctx.tenantId).in("status", ["dispatched", "partially_returned"]).order("expected_return_at").limit(100);
  if (term) {
    const { data: hits } = await ctx.supabase.from("rental_items").select("rental_id").eq("tenant_id", ctx.tenantId)
      .or(`description.ilike.%${term}%,asset_code.ilike.%${term}%`).limit(200);
    const ids = [...new Set((hits ?? []).map((h) => h.rental_id))];
    query = query.or([`reference.ilike.%${term}%`, `client_name.ilike.%${term}%`, `project_name.ilike.%${term}%`, ids.length ? `id.in.(${ids.join(",")})` : ""].filter(Boolean).join(","));
  }
  const { data: rentals } = await query;
  const tz = ctx.settings.timezone;
  return (
    <>
      <PageHeader title="Record a return" subtitle="Find the rental by reference, client, project or equipment." />
      <Card padded={false}>
        <form className="flex gap-2 border-b border-line p-4">
          <input name="q" defaultValue={q} autoFocus placeholder="RNT-0012, client, project, CAM-001…" className="input sm:max-w-md" />
          <button className="btn-primary">Find</button>
        </form>
        {rentals?.length ? (
          <Table head={<tr><th className="th">Rental</th><th className="th">Client / project</th><th className="th">Due</th><th className="th text-right">Out</th><th className="th">Status</th><th className="th"></th></tr>}>
            {rentals.map((r) => (
              <tr key={r.id}>
                <td className="td font-medium">{r.reference}</td>
                <td className="td">{r.client_name}<div className="text-xs text-muted">{r.project_name}</div></td>
                <td className={`td ${r.is_overdue ? "font-medium text-red-700" : ""}`}>{dateTime(r.expected_return_at, tz)}</td>
                <td className="td text-right tabular-nums">{r.qty_outstanding}</td>
                <td className="td"><Badge status={r.display_status} /></td>
                <td className="td text-right"><Link href={`/rentals/${r.id}/return`} className="btn-primary py-1.5">Return</Link></td>
              </tr>
            ))}
          </Table>
        ) : <EmptyState title={term ? "No open rentals match" : "Nothing is out right now"} />}
      </Card>
    </>
  );
}
