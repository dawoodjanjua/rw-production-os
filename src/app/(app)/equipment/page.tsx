import Link from "next/link";
import { Plus } from "lucide-react";
import { requireTenant, roleAtLeast } from "@/lib/auth";
import { money } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui";

export const metadata = { title: "Equipment" };

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; show?: string }> }) {
  const ctx = await requireTenant();
  const { q = "", category = "", show = "" } = await searchParams;
  const { data: categories } = await ctx.supabase.from("equipment_categories").select("id,name").eq("tenant_id", ctx.tenantId).order("name");

  let query = ctx.supabase.from("v_equipment_availability").select("*").eq("tenant_id", ctx.tenantId).order("name");
  if (show !== "archived") query = query.is("archived_at", null); else query = query.not("archived_at", "is", null);
  if (category) query = query.eq("category_id", category);
  if (q) {
    const term = q.replace(/[%,()]/g, " ").trim();
    const { data: assetHits } = await ctx.supabase.from("equipment_assets").select("item_id")
      .eq("tenant_id", ctx.tenantId).or(`asset_code.ilike.%${term}%,serial_number.ilike.%${term}%`).limit(50);
    const ids = [...new Set((assetHits ?? []).map((a) => a.item_id))];
    query = query.or([`name.ilike.%${term}%`, `code.ilike.%${term}%`, ids.length ? `id.in.(${ids.join(",")})` : ""].filter(Boolean).join(","));
  }
  const { data: items } = await query;
  const canEdit = roleAtLeast(ctx.role, "manager");
  const cur = ctx.settings.currency;

  return (
    <>
      <PageHeader title="Equipment inventory" subtitle="Track assets, kits and availability. Availability updates from dispatches and returns."
        actions={canEdit && <Link href="/equipment/new" className="btn-primary"><Plus size={16} />Add item</Link>} />
      <Card padded={false}>
        <form className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row">
          <input name="q" defaultValue={q} placeholder="Search equipment, asset code or serial…" className="input sm:max-w-sm" />
          <select name="category" defaultValue={category} className="input sm:w-44">
            <option value="">All categories</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="show" defaultValue={show} className="input sm:w-36">
            <option value="">Active</option><option value="archived">Archived</option>
          </select>
          <button className="btn-secondary">Filter</button>
        </form>
        {items && items.length > 0 ? (
          <Table head={<tr><th className="th">Item / code</th><th className="th">Category</th><th className="th text-right">Qty</th><th className="th text-right">Available</th><th className="th text-right">Rate / shift</th><th className="th text-right">Rate / day</th><th className="th">Status</th></tr>}>
            {items.map((i) => {
              const status = i.archived_at ? "retired" : i.qty_available > 0 ? "available" : i.qty_out > 0 ? "dispatched" : i.qty_reserved > 0 ? "reserved" : i.qty_unavailable > 0 ? "maintenance" : "missing";
              return (
                <tr key={i.id} className="hover:bg-bg/50">
                  <td className="td"><Link href={`/equipment/${i.id}`} className="font-medium hover:underline">{i.name}</Link>
                    <div className="text-xs text-muted">{[i.code, i.tracking === "serialized" ? "Serialized" : "Quantity-based", i.is_kit ? "Kit" : null].filter(Boolean).join(" · ")}</div></td>
                  <td className="td text-muted">{i.category_name ?? "—"}</td>
                  <td className="td text-right tabular-nums">{i.quantity_total}</td>
                  <td className="td text-right tabular-nums">{i.qty_available}{i.qty_out > 0 && <div className="text-xs text-muted">{i.qty_out} out</div>}</td>
                  <td className="td text-right tabular-nums">{i.effective_shift_rate != null ? money(i.effective_shift_rate, cur) : "—"}</td>
                  <td className="td text-right tabular-nums">{i.effective_day_rate != null ? money(i.effective_day_rate, cur) : "—"}</td>
                  <td className="td"><Badge status={status}>{status === "dispatched" ? "All on rent" : status === "maintenance" ? "Unavailable" : undefined}</Badge></td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <EmptyState title={q || category ? "No matching equipment" : "No equipment yet"}
            body={q || category ? "Try a different search." : "Add your cameras, lenses, lights and grip so you can dispatch them on rentals."}
            action={canEdit && !q && <Link href="/equipment/new" className="btn-primary"><Plus size={16} />Add your first item</Link>} />
        )}
      </Card>
    </>
  );
}
