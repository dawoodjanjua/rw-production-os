import { notFound } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ItemForm } from "../../item-form";

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageRole("manager");
  const [{ data: item }, { data: categories }, { data: suppliers }] = await Promise.all([
    ctx.supabase.from("equipment_items").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    ctx.supabase.from("equipment_categories").select("id,name").eq("tenant_id", ctx.tenantId).order("name"),
    ctx.supabase.from("suppliers").select("id,name").eq("tenant_id", ctx.tenantId).order("name"),
  ]);
  if (!item) notFound();
  return (
    <div className="max-w-3xl">
      <PageHeader title={`Edit ${item.name}`} />
      <ItemForm item={item} categories={categories ?? []} suppliers={suppliers ?? []} currency={ctx.settings.currency} />
    </div>
  );
}
