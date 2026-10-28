import { notFound, redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { InvoiceEditor } from "../../invoice-editor";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageRole("manager");
  const [{ data: inv }, { data: items }, { data: clients }, { data: rentals }] = await Promise.all([
    ctx.supabase.from("invoices").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    ctx.supabase.from("invoice_items").select("*").eq("invoice_id", id).eq("tenant_id", ctx.tenantId).order("sort_order"),
    ctx.supabase.from("clients").select("id,name").eq("tenant_id", ctx.tenantId).order("name"),
    ctx.supabase.from("rentals").select("id,reference,client_id,project_name").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(300),
  ]);
  if (!inv) notFound();
  if (inv.status !== "draft") redirect(`/invoices/${id}`);
  return (
    <div className="max-w-5xl">
      <PageHeader title={`Edit ${inv.number}`} />
      <InvoiceEditor clients={clients ?? []} rentals={rentals ?? []} currency={inv.currency} initial={{
        invoice_id: id, client_id: inv.client_id, rental_id: inv.rental_id ?? "", project_name: inv.project_name ?? "", issue_date: inv.issue_date, due_date: inv.due_date,
        discount_amount: String(inv.discount_amount), tax_rate: String(inv.tax_rate), notes: inv.notes ?? "", payment_instructions: inv.payment_instructions ?? "",
        items: (items ?? []).map((i) => ({ description: i.description, quantity: String(i.quantity), unit_price: String(i.unit_price) })),
      }} />
    </div>
  );
}
