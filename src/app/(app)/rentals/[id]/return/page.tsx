import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth";
import { dateTime, toLocalInput } from "@/lib/format";
import { Notice, PageHeader } from "@/components/ui";
import { ReturnForm } from "./return-form";

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  const [{ data: r }, { data: lines }] = await Promise.all([
    ctx.supabase.from("v_rentals").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    ctx.supabase.from("rental_items").select("id,description,asset_code,quantity,qty_returned,qty_missing").eq("rental_id", id).eq("tenant_id", ctx.tenantId).order("description").order("asset_code"),
  ]);
  if (!r) notFound();
  const tz = ctx.settings.timezone;
  return (
    <div className="max-w-5xl">
      <PageHeader title={`Return · ${r.reference}`} subtitle={`${r.client_name}${r.project_name ? ` · ${r.project_name}` : ""} · due ${dateTime(r.expected_return_at, tz)}`} />
      {["dispatched", "partially_returned"].includes(r.status)
        ? <ReturnForm rentalId={id} lines={lines ?? []} nowLocal={toLocalInput(new Date(), tz)} />
        : <Notice tone="warn">This rental is not out (status: {r.status}). Nothing to return.</Notice>}
    </div>
  );
}
