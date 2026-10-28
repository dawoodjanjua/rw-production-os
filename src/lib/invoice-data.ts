import "server-only";
import type { TenantContext } from "@/lib/auth";

export type Company = { company_name: string; tagline?: string | null; logo_path?: string | null; brand_color?: string; phone?: string | null; whatsapp?: string | null; email?: string | null; address?: string | null; website?: string | null; ntn?: string | null; invoice_footer?: string | null };
export type BillTo = { name: string; contact_person?: string | null; phone?: string | null; whatsapp?: string | null; email?: string | null; address?: string | null };

/** Loads an invoice through the user's RLS-scoped client. Returns null if it is not in the active tenant. */
export async function loadInvoice(ctx: TenantContext, id: string) {
  const [{ data: inv }, { data: items }, { data: payments }] = await Promise.all([
    ctx.supabase.from("v_invoices").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    ctx.supabase.from("invoice_items").select("*").eq("invoice_id", id).eq("tenant_id", ctx.tenantId).order("sort_order"),
    ctx.supabase.from("payments").select("*").eq("invoice_id", id).eq("tenant_id", ctx.tenantId).order("paid_at"),
  ]);
  if (!inv) return null;
  let client: BillTo = inv.client_snapshot;
  if (!client) {
    const { data } = await ctx.supabase.from("clients").select("name,contact_person,phone,whatsapp,email,address").eq("id", inv.client_id).single();
    client = data as BillTo;
  }
  // Issued invoices use the company details captured at issue time; drafts show current settings.
  const company: Company = inv.company_snapshot ?? ctx.settings;
  return { inv, items: items ?? [], payments: payments ?? [], client, company, brand: company.brand_color || ctx.settings.brand_color };
}
