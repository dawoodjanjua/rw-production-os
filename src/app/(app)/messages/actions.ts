"use server";

import { requireTenant } from "@/lib/auth";
import { friendlyError } from "@/lib/actions";

/** Record that a user opened WhatsApp with a prepared message. This is NOT a delivery confirmation. */
export async function logHandoff(p: { purpose: string; to_phone: string; body: string; rental_id?: string; invoice_id?: string; client_id?: string; reminder_id?: string }) {
  try {
    const ctx = await requireTenant();
    const { error } = await ctx.supabase.rpc("log_whatsapp_handoff", { p: { ...p, tenant_id: ctx.tenantId } });
    if (error) return { error: friendlyError(error) };
    return { ok: true };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
