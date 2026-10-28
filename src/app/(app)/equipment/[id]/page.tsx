import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant, roleAtLeast } from "@/lib/auth";
import { dateTime, money } from "@/lib/format";
import { Badge, Card, DL, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { addAsset, setArchived, updateAsset } from "../actions";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  const tz = ctx.settings.timezone, cur = ctx.settings.currency;
  const [{ data: item }, { data: avail }, { data: assets }, { data: history }] = await Promise.all([
    ctx.supabase.from("equipment_items").select("*, equipment_categories(name), suppliers(name)").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    ctx.supabase.from("v_equipment_availability").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    ctx.supabase.from("equipment_assets").select("*").eq("item_id", id).eq("tenant_id", ctx.tenantId).order("asset_code"),
    ctx.supabase.from("rental_items").select("id, quantity, qty_returned, qty_missing, qty_damaged, asset_code, line_total, rentals!inner(id, reference, status, start_at, expected_return_at, returned_at, clients(name))")
      .eq("item_id", id).eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(50),
  ]);
  if (!item || !avail) notFound();
  const canEdit = roleAtLeast(ctx.role, "manager");
  const now = Date.now();

  return (
    <>
      <PageHeader title={item.name}
        subtitle={[item.code, item.equipment_categories?.name, item.tracking === "serialized" ? "Individually tracked" : "Quantity-based", item.is_kit ? "Kit" : null].filter(Boolean).join(" · ")}
        actions={canEdit && <>
          <Link href={`/equipment/${id}/edit`} className="btn-secondary">Edit</Link>
          <form action={setArchived}><input type="hidden" name="id" value={id} /><input type="hidden" name="archive" value={item.archived_at ? "0" : "1"} />
            <button className="btn-ghost">{item.archived_at ? "Restore" : "Archive"}</button></form>
        </>} />
      {item.archived_at && <div className="mb-4"><Badge status="retired">Archived — not available for new rentals</Badge></div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available" value={avail.qty_available} hint={`of ${avail.quantity_total}`} />
        <Stat label="On rent" value={avail.qty_out} />
        <Stat label="Reserved" value={avail.qty_reserved} />
        <Stat label="Out of service" value={avail.qty_unavailable} hint="maintenance, damaged or missing" tone={avail.qty_unavailable > 0 ? "warn" : "default"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-1">
          <DL items={[
            ["Rate per shift", avail.effective_shift_rate != null ? money(avail.effective_shift_rate, cur) + (item.shift_rate == null ? " (category)" : "") : "Not set"],
            ["Rate per day", avail.effective_day_rate != null ? money(avail.effective_day_rate, cur) + (item.day_rate == null ? " (category)" : "") : "Not set"],
            ["Purchase cost", item.purchase_cost != null ? money(item.purchase_cost, cur) : "—"],
            ["Replacement value", item.replacement_value != null ? money(item.replacement_value, cur) : "—"],
            ["Condition", item.condition],
            ["Source", item.suppliers?.name ?? "Own inventory"],
          ]} />
          {item.description && <p className="mt-4 text-sm text-muted">{item.description}</p>}
          {item.accessories && <div className="mt-4 text-sm"><div className="text-xs text-muted">Accessories / kit contents</div><p className="whitespace-pre-line">{item.accessories}</p></div>}
          {item.condition_notes && <div className="mt-4 text-sm"><div className="text-xs text-muted">Condition notes</div><p className="whitespace-pre-line">{item.condition_notes}</p></div>}
        </Card>

        <div className="space-y-6 lg:col-span-2">
          {item.tracking === "serialized" && (
            <Card title={`Units (${assets?.length ?? 0})`} padded={false}>
              {assets && assets.length > 0 ? (
                <Table head={<tr><th className="th">Asset code</th><th className="th">Serial</th><th className="th">Status</th><th className="th">Condition / notes</th>{canEdit && <th className="th"></th>}</tr>}>
                  {assets.map((a) => (
                    <tr key={a.id}>
                      <td className="td font-medium">{a.asset_code}</td>
                      <td className="td text-muted">{a.serial_number ?? "—"}</td>
                      <td className="td"><Badge status={a.status} /></td>
                      <td className="td" colSpan={canEdit ? 2 : 1}>
                        {canEdit && !["reserved", "dispatched"].includes(a.status) ? (
                          <ActionForm action={updateAsset} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="id" value={a.id} /><input type="hidden" name="item_id" value={id} />
                            <input type="hidden" name="serial_number" value={a.serial_number ?? ""} />
                            <select name="status" defaultValue={a.status} className="input w-36 py-1">
                              {["available", "maintenance", "damaged", "missing", "retired"].map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <select name="condition" defaultValue={a.condition} className="input w-28 py-1">{["new", "good", "fair", "worn", "damaged"].map((c) => <option key={c}>{c}</option>)}</select>
                            <input name="notes" defaultValue={a.notes ?? ""} placeholder="Notes" className="input w-40 py-1" />
                            <SubmitButton className="btn-secondary py-1">Update</SubmitButton>
                          </ActionForm>
                        ) : <span className="text-muted">{a.condition}{a.notes ? ` · ${a.notes}` : ""}</span>}
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : <EmptyState title="No units yet" body="Add each physical unit with its asset code so it can be dispatched." />}
              {canEdit && (
                <ActionForm action={addAsset} resetOnSuccess className="grid gap-2 border-t border-line p-4 sm:grid-cols-[1fr_1fr_auto]">
                  <input type="hidden" name="item_id" value={id} />
                  <input name="asset_code" required placeholder="Asset code (e.g. CAM-003)" className="input" />
                  <input name="serial_number" placeholder="Serial number" className="input" />
                  <SubmitButton className="btn-secondary">Add unit</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}

          <Card title="Rental history" padded={false}>
            {history && history.length > 0 ? (
              <Table head={<tr><th className="th">Rental</th><th className="th">Client</th><th className="th">Out</th><th className="th">Return</th><th className="th text-right">Qty</th><th className="th">Status</th></tr>}>
                {history.map((h) => {
                  const r = h.rentals as unknown as { id: string; reference: string; status: string; start_at: string; expected_return_at: string; returned_at: string | null; clients: { name: string } };
                  const overdue = ["dispatched", "partially_returned"].includes(r.status) && new Date(r.expected_return_at).getTime() < now;
                  return (
                    <tr key={h.id}>
                      <td className="td"><Link className="link font-medium" href={`/rentals/${r.id}`}>{r.reference}</Link>{h.asset_code && <div className="text-xs text-muted">{h.asset_code}</div>}</td>
                      <td className="td">{r.clients?.name}</td>
                      <td className="td text-muted">{dateTime(r.start_at, tz)}</td>
                      <td className="td text-muted">{r.returned_at ? dateTime(r.returned_at, tz) : `Due ${dateTime(r.expected_return_at, tz)}`}</td>
                      <td className="td text-right tabular-nums">{h.quantity}{h.qty_missing > 0 && <div className="text-xs text-red-700">{h.qty_missing} missing</div>}{h.qty_damaged > 0 && <div className="text-xs text-amber-700">{h.qty_damaged} damaged</div>}</td>
                      <td className="td"><Badge status={overdue ? "overdue" : r.status} /></td>
                    </tr>
                  );
                })}
              </Table>
            ) : <EmptyState title="Not rented yet" />}
          </Card>
        </div>
      </div>
    </>
  );
}
