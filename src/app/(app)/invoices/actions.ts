"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth";
import { friendlyError, optNum, str, type ActionState } from "@/lib/actions";
import { fromLocalInput } from "@/lib/format";

export type InvoiceDraft = {
  invoice_id?: string; client_id: string; rental_id?: string; project_name?: string; issue_date?: string; due_date?: string;
  discount_amount?: string; tax_rate?: string; notes?: string; payment_instructions?: string;
  items: { description: string; quantity: string; unit_price: string }[];
};

function clean(d: InvoiceDraft) {
  const items = d.items.filter((i) => i.description.trim()).map((i) => {
    const quantity = Number(String(i.quantity).replace(/,/g, ""));
    const unit_price = Number(String(i.unit_price).replace(/,/g, ""));
    if (!(quantity > 0)) throw new Error(`Quantity for "${i.description}" must be greater than zero`);
    if (!(unit_price >= 0)) throw new Error(`Price for "${i.description}" is not valid`);
    return { description: i.description.trim(), quantity, unit_price };
  });
  if (!d.client_id) throw new Error("Select a client");
  if (items.length === 0) throw new Error("Add at least one line item");
  return { ...d, items, discount_amount: d.discount_amount?.replace(/,/g, "") || "0" };
}

export async function saveInvoice(d: InvoiceDraft): Promise<{ error?: string }> {
  let id = d.invoice_id;
  try {
    const ctx = await requireTenant("manager");
    const p = clean(d);
    if (id) {
      const { error } = await ctx.supabase.rpc("update_invoice_draft", { p: { ...p, invoice_id: id } });
      if (error) return { error: friendlyError(error) };
    } else {
      const { data, error } = await ctx.supabase.rpc("create_invoice", { p: { ...p, tenant_id: ctx.tenantId } });
      if (error) return { error: friendlyError(error) };
      id = data as string;
    }
  } catch (e) {
    return { error: friendlyError(e) };
  }
  revalidatePath("/invoices");
  redirect(`/invoices/${id}`);
}

async function simple(fn: string, args: Record<string, unknown>, id: string, ok: string, min: "manager" | "owner" = "manager"): Promise<ActionState> {
  try {
    const ctx = await requireTenant(min);
    const { error } = await ctx.supabase.rpc(fn, args);
    if (error) return { error: friendlyError(error) };
  } catch (e) {
    return { error: friendlyError(e) };
  }
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  return { ok };
}

export async function issueInvoice(_: ActionState, fd: FormData) {
  return simple("issue_invoice", { p_invoice: str(fd, "invoice_id") }, str(fd, "invoice_id"), "Invoice issued. Company and client details are now locked on this invoice.");
}

export async function voidInvoice(_: ActionState, fd: FormData) {
  return simple("void_invoice", { p_invoice: str(fd, "invoice_id"), p_reason: str(fd, "reason") }, str(fd, "invoice_id"), "Invoice voided.", "owner");
}

export async function deleteDraft(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await simple("delete_draft_invoice", { p_invoice: str(fd, "invoice_id") }, str(fd, "invoice_id"), "Deleted");
  if (r?.error) return r;
  redirect("/invoices");
}

export async function recordPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenant("manager");
    const id = str(fd, "invoice_id");
    const at = str(fd, "paid_local");
    const amount = optNum(fd, "amount");
    if (!amount) return { error: "Enter the amount received." };
    const { error } = await ctx.supabase.rpc("record_payment", {
      p_invoice: id, p_amount: amount, p_paid_at: at ? fromLocalInput(at, ctx.settings.timezone) : null,
      p_method: str(fd, "method") || "cash", p_reference: str(fd, "reference") || null, p_notes: str(fd, "notes") || null,
    });
    if (error) return { error: friendlyError(error) };
    revalidatePath(`/invoices/${id}`);
    revalidatePath("/dashboard");
    return { ok: "Payment recorded." };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function deletePayment(_: ActionState, fd: FormData) {
  return simple("delete_payment", { p_payment: str(fd, "payment_id") }, str(fd, "invoice_id"), "Payment removed.", "owner");
}
