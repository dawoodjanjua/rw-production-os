import { requirePageRole } from "@/lib/auth";
import { todayInTz } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { InvoiceEditor } from "../invoice-editor";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const ctx = await requirePageRole("manager");
  const { client } = await searchParams;
  const [{ data: clients }, { data: rentals }] = await Promise.all([
    ctx.supabase.from("clients").select("id,name").eq("tenant_id", ctx.tenantId).is("archived_at", null).order("name"),
    ctx.supabase.from("rentals").select("id,reference,client_id,project_name").eq("tenant_id", ctx.tenantId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(300),
  ]);
  const today = todayInTz(ctx.settings.timezone);
  const due = new Date(Date.parse(today + "T00:00:00Z") + ctx.settings.payment_terms_days * 86400000).toISOString().slice(0, 10);
  return (
    <div className="max-w-5xl">
      <PageHeader title="New invoice" subtitle="For rental invoices, open the rental and use “Create invoice” to copy its lines automatically." />
      <InvoiceEditor clients={clients ?? []} rentals={rentals ?? []} currency={ctx.settings.currency}
        initial={{ client_id: client ?? "", issue_date: today, due_date: due, tax_rate: String(ctx.settings.tax_rate), payment_instructions: ctx.settings.payment_instructions ?? "", items: [] }} />
    </div>
  );
}
