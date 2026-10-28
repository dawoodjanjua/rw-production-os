import { requirePageRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ItemForm } from "../item-form";

export const metadata = { title: "Add equipment" };

export default async function NewItemPage() {
  const ctx = await requirePageRole("manager");
  const [{ data: categories }, { data: suppliers }] = await Promise.all([
    ctx.supabase.from("equipment_categories").select("id,name").eq("tenant_id", ctx.tenantId).order("name"),
    ctx.supabase.from("suppliers").select("id,name").eq("tenant_id", ctx.tenantId).is("archived_at", null).order("name"),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Add equipment" />
      <ItemForm categories={categories ?? []} suppliers={suppliers ?? []} currency={ctx.settings.currency} />
    </div>
  );
}
