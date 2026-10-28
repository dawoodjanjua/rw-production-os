"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/auth";
import { friendlyError, type ActionState } from "@/lib/actions";
import { processDueReminders } from "@/lib/messaging/reminders";

export async function setPaused(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenant("manager");
    const paused = fd.get("paused") === "1";
    const { error } = await ctx.supabase.rpc("set_reminders_paused", { p_tenant: ctx.tenantId, p_paused: paused });
    if (error) return { error: friendlyError(error) };
    revalidatePath("/reminders");
    return { ok: paused ? "Automatic reminders paused." : "Automatic reminders resumed." };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

/** Process this workspace's due reminders now (same logic as the scheduler, limited to the caller's tenant). */
export async function runNow(): Promise<ActionState> {
  try {
    const ctx = await requireTenant("manager");
    const s = await processDueReminders({ tenantId: ctx.tenantId, limit: 50 });
    revalidatePath("/reminders");
    return { ok: `Processed ${s.claimed} due job(s): ${s.dry_run} dry run, ${s.sent} sent, ${s.skipped} skipped, ${s.cancelled} cancelled, ${s.rescheduled} deferred, ${s.failed} failed.` };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
