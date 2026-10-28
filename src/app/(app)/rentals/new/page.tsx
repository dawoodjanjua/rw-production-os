import Link from "next/link";
import { requireTenant, roleAtLeast } from "@/lib/auth";
import { todayInTz, toLocalInput } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui";
import { DispatchForm } from "./dispatch-form";

export const metadata = { title: "New dispatch" };

export default async function NewRentalPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const ctx = await requireTenant();
  const { client } = await searchParams;
  const [{ data: clients }, { data: items }, { data: assets }, { data: shifts }] = await Promise.all([
    ctx.supabase.from("clients").select("id,name,contact_person,whatsapp").eq("tenant_id", ctx.tenantId).is("archived_at", null).order("name"),
    ctx.supabase.from("v_equipment_availability").select("id,name,code,tracking,category_name,qty_available,effective_shift_rate,effective_day_rate").eq("tenant_id", ctx.tenantId).is("archived_at", null).order("name"),
    ctx.supabase.from("equipment_assets").select("id,item_id,asset_code,serial_number").eq("tenant_id", ctx.tenantId).eq("status", "available").order("asset_code"),
    ctx.supabase.from("shift_rules").select("id,name,start_time,end_time,rate_multiplier").eq("tenant_id", ctx.tenantId).eq("active", true).order("sort_order"),
  ]);
  const tz = ctx.settings.timezone;
  if (!items?.length) {
    return <><PageHeader title="New dispatch" /><div className="card"><EmptyState title="Add equipment first" body="You need at least one equipment item before creating a rental." action={<Link href="/equipment/new" className="btn-primary">Add equipment</Link>} /></div></>;
  }
  return (
    <>
      <PageHeader title="New equipment dispatch" subtitle="Create a rental and calculate its return deadline from your shift and day rules." />
      <DispatchForm clients={clients ?? []} items={items} assets={assets ?? []} shifts={shifts ?? []} currency={ctx.settings.currency} tz={tz}
        nowLocal={toLocalInput(new Date(), tz)} todayLocal={todayInTz(tz)} canOverride={roleAtLeast(ctx.role, "manager")} defaultClient={client} />
    </>
  );
}
