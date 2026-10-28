"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth";
import { fromLocalInput } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import { friendlyError, optNum, str, type ActionState } from "@/lib/actions";

export type RentalDraft = {
  client_id: string; project_name?: string; location?: string; responsible_name?: string; responsible_whatsapp?: string;
  rental_type: "shift" | "full_day" | "custom"; shift_rule_id?: string; shift_date?: string; units?: number;
  start_local?: string; custom_return_local?: string; deposit_amount?: string; discount_amount?: string;
  notes?: string; dispatch_condition?: string; dispatch_now: boolean;
  items: { item_id: string; quantity: number; asset_ids?: string[]; unit_rate_override?: string }[];
};

function toPayload(d: RentalDraft, tenantId: string, tz: string) {
  return {
    tenant_id: tenantId,
    client_id: d.client_id,
    project_name: d.project_name, location: d.location, responsible_name: d.responsible_name,
    responsible_whatsapp: normalizePhone(d.responsible_whatsapp),
    rental_type: d.rental_type,
    shift_rule_id: d.rental_type === "shift" ? d.shift_rule_id : null,
    shift_date: d.rental_type === "shift" ? d.shift_date || null : null,
    units: d.units ?? 1,
    start_at: d.start_local ? fromLocalInput(d.start_local, tz) : new Date().toISOString(),
    custom_return_at: d.rental_type === "custom" && d.custom_return_local ? fromLocalInput(d.custom_return_local, tz) : null,
    deposit_amount: d.deposit_amount?.replace(/,/g, "") || 0,
    discount_amount: d.discount_amount?.replace(/,/g, "") || 0,
    notes: d.notes, dispatch_condition: d.dispatch_condition, dispatch_now: d.dispatch_now,
    items: d.items.map((i) => ({
      item_id: i.item_id, quantity: i.asset_ids?.length || i.quantity, asset_ids: i.asset_ids ?? [],
      unit_rate_override: i.unit_rate_override?.replace(/,/g, "") || null,
    })),
  };
}

export type Quote = {
  start_at: string; expected_return_at: string; units: number; billing_basis: "shift" | "day"; subtotal: number; currency: string;
  shift: { name: string; start_time: string; end_time: string; rate_multiplier: number } | null;
  lines: { item_id: string; name: string; quantity: number; unit_rate: number; rate_source: string; units: number; line_total: number }[];
};

export async function quoteRental(d: RentalDraft): Promise<{ quote?: Quote; error?: string }> {
  try {
    const ctx = await requireTenant();
    if (d.items.length === 0 || (d.rental_type === "shift" && !d.shift_rule_id) || (d.rental_type === "custom" && !d.custom_return_local)) return {};
    const { data, error } = await ctx.supabase.rpc("quote_rental", { p: toPayload(d, ctx.tenantId, ctx.settings.timezone) });
    if (error) return { error: friendlyError(error) };
    return { quote: data as Quote };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function createRental(d: RentalDraft): Promise<{ error?: string }> {
  let id: string;
  try {
    const ctx = await requireTenant();
    if (!d.client_id) return { error: "Select a client." };
    if (d.items.length === 0) return { error: "Add at least one equipment item." };
    const { data, error } = await ctx.supabase.rpc("create_rental", { p: toPayload(d, ctx.tenantId, ctx.settings.timezone) });
    if (error) return { error: friendlyError(error) };
    id = data as string;
  } catch (e) {
    return { error: friendlyError(e) };
  }
  revalidatePath("/rentals");
  revalidatePath("/dashboard");
  redirect(`/rentals/${id}?created=1`);
}

async function rpcAction(fn: string, args: Record<string, unknown>, rentalId: string, ok: string): Promise<ActionState> {
  try {
    const ctx = await requireTenant();
    const { error } = await ctx.supabase.rpc(fn, args);
    if (error) return { error: friendlyError(error) };
  } catch (e) {
    return { error: friendlyError(e) };
  }
  revalidatePath(`/rentals/${rentalId}`);
  revalidatePath("/dashboard");
  return { ok };
}

export async function dispatchReserved(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireTenant();
  const id = str(fd, "rental_id");
  const at = str(fd, "dispatch_local");
  return rpcAction("dispatch_rental", { p_rental: id, p_dispatch_at: at ? fromLocalInput(at, ctx.settings.timezone) : null, p_condition: str(fd, "condition") || null }, id, "Equipment dispatched.");
}

export async function extendRental(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireTenant();
  const id = str(fd, "rental_id");
  const deadline = str(fd, "new_deadline_local");
  return rpcAction("extend_rental", {
    p_rental: id, p_additional_units: optNum(fd, "additional_units"),
    p_new_deadline: deadline ? fromLocalInput(deadline, ctx.settings.timezone) : null, p_reason: str(fd, "reason") || null,
  }, id, "Rental extended. Reminders were rescheduled.");
}

export async function addCharge(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "rental_id");
  try {
    return rpcAction("add_rental_charge", { p_rental: id, p_kind: str(fd, "kind"), p_description: str(fd, "description"), p_amount: optNum(fd, "amount") }, id, "Charge added.");
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function removeCharge(_: ActionState, fd: FormData): Promise<ActionState> {
  return rpcAction("remove_rental_charge", { p_charge: str(fd, "charge_id"), p_reason: str(fd, "reason") || null }, str(fd, "rental_id"), "Charge removed.");
}

export async function cancelRental(_: ActionState, fd: FormData): Promise<ActionState> {
  return rpcAction("cancel_rental", { p_rental: str(fd, "rental_id"), p_reason: str(fd, "reason") || null }, str(fd, "rental_id"), "Reservation cancelled.");
}

export async function closeRental(_: ActionState, fd: FormData): Promise<ActionState> {
  return rpcAction("close_rental", { p_rental: str(fd, "rental_id") }, str(fd, "rental_id"), "Rental closed.");
}

export async function invoiceFromRental(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireTenant("manager");
    const { data, error } = await ctx.supabase.rpc("create_invoice_from_rental", { p_rental: str(fd, "rental_id") });
    if (error) return { error: friendlyError(error) };
    id = data as string;
  } catch (e) {
    return { error: friendlyError(e) };
  }
  revalidatePath("/invoices");
  redirect(`/invoices/${id}`);
}

export type ReturnDraft = { rental_id: string; returned_local?: string; notes?: string; lines: { rental_item_id: string; returned: number; damaged: number; missing: number; condition?: string }[] };

export async function recordReturn(d: ReturnDraft): Promise<{ error?: string }> {
  try {
    const ctx = await requireTenant();
    const lines = d.lines.filter((l) => l.returned > 0 || l.missing > 0);
    if (lines.length === 0) return { error: "Enter at least one returned or missing quantity." };
    const { error } = await ctx.supabase.rpc("record_return", { p: {
      rental_id: d.rental_id, notes: d.notes, lines,
      returned_at: d.returned_local ? fromLocalInput(d.returned_local, ctx.settings.timezone) : new Date().toISOString(),
    } });
    if (error) return { error: friendlyError(error) };
  } catch (e) {
    return { error: friendlyError(e) };
  }
  revalidatePath(`/rentals/${d.rental_id}`);
  revalidatePath("/dashboard");
  redirect(`/rentals/${d.rental_id}?returned=1`);
}
