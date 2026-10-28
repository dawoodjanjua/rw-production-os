"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";
import { setupLink, userWithSetupLink } from "@/lib/provisioning";
import { friendlyError, optNum, optStr, str, type ActionState } from "@/lib/actions";
import type { Role } from "@/lib/auth";

const done = (ok: string): ActionState => { revalidatePath("/", "layout"); return { ok }; };

export async function saveCompany(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenant("owner");
    const color = str(fd, "brand_color");
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: "Brand colour must be a hex value like #1f4d3a." };
    const tz = str(fd, "timezone");
    if (!Intl.supportedValuesOf("timeZone").includes(tz) && tz !== "UTC") return { error: "Unknown timezone." };
    const { error } = await ctx.supabase.from("tenant_settings").update({
      company_name: str(fd, "company_name"), tagline: optStr(fd, "tagline"), brand_color: color,
      phone: normalizePhone(optStr(fd, "phone")), whatsapp: normalizePhone(optStr(fd, "whatsapp")), email: optStr(fd, "email"),
      address: optStr(fd, "address"), website: optStr(fd, "website"), ntn: optStr(fd, "ntn"),
      currency: str(fd, "currency").toUpperCase() || "PKR", timezone: tz,
      invoice_prefix: str(fd, "invoice_prefix").toUpperCase(), rental_prefix: str(fd, "rental_prefix").toUpperCase(),
      invoice_footer: optStr(fd, "invoice_footer"), payment_instructions: optStr(fd, "payment_instructions"),
      payment_terms_days: optNum(fd, "payment_terms_days") ?? 7, tax_rate: optNum(fd, "tax_rate") ?? 0,
    }).eq("tenant_id", ctx.tenantId);
    if (error) return { error: friendlyError(error) };
    return done("Company settings saved.");
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function uploadLogo(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenant("owner");
    const file = fd.get("logo");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose an image file." };
    if (!["image/png", "image/jpeg"].includes(file.type)) return { error: "Use a PNG or JPG image." };
    if (file.size > 2 * 1024 * 1024) return { error: "Logo must be under 2 MB." };
    const path = `${ctx.tenantId}/logo-${Date.now()}.${file.type === "image/png" ? "png" : "jpg"}`;
    const { error } = await ctx.supabase.storage.from("tenant-files").upload(path, file, { contentType: file.type, upsert: false });
    if (error) return { error: friendlyError(error) };
    const old = ctx.settings.logo_path;
    const { error: e2 } = await ctx.supabase.from("tenant_settings").update({ logo_path: path }).eq("tenant_id", ctx.tenantId);
    if (e2) return { error: friendlyError(e2) };
    if (old) await ctx.supabase.storage.from("tenant-files").remove([old]);
    return done("Logo updated.");
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function removeLogo(_: ActionState): Promise<ActionState> {
  const ctx = await requireTenant("owner");
  if (ctx.settings.logo_path) await ctx.supabase.storage.from("tenant-files").remove([ctx.settings.logo_path]);
  await ctx.supabase.from("tenant_settings").update({ logo_path: null }).eq("tenant_id", ctx.tenantId);
  return done("Logo removed.");
}

export async function saveBillingRules(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenant("owner");
    const { error } = await ctx.supabase.from("tenant_settings").update({
      grace_minutes: optNum(fd, "grace_minutes") ?? 0, late_fee_mode: str(fd, "late_fee_mode"), late_fee_amount: optNum(fd, "late_fee_amount") ?? 0,
    }).eq("tenant_id", ctx.tenantId);
    if (error) return { error: friendlyError(error) };
    return done("Billing rules saved. They apply to new rentals; existing rentals keep the terms they were created with.");
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function saveShift(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenant("owner");
    const id = str(fd, "id");
    const row = { name: str(fd, "name"), start_time: str(fd, "start_time"), end_time: str(fd, "end_time"), rate_multiplier: optNum(fd, "rate_multiplier") ?? 1, sort_order: optNum(fd, "sort_order") ?? 0, active: fd.get("active") === "on" };
    if (!row.name || !row.start_time || !row.end_time) return { error: "Name, start and end time are required." };
    const { error } = id
      ? await ctx.supabase.from("shift_rules").update(row).eq("id", id).eq("tenant_id", ctx.tenantId)
      : await ctx.supabase.from("shift_rules").insert({ ...row, tenant_id: ctx.tenantId, active: true });
    if (error) return { error: friendlyError(error) };
    return done(id ? "Shift saved." : "Shift added.");
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function saveCategory(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenant("manager");
    const id = str(fd, "id");
    const row = { name: str(fd, "name"), default_shift_rate: optNum(fd, "default_shift_rate"), default_day_rate: optNum(fd, "default_day_rate") };
    if (!row.name) return { error: "Category name is required." };
    const { error } = id
      ? await ctx.supabase.from("equipment_categories").update(row).eq("id", id).eq("tenant_id", ctx.tenantId)
      : await ctx.supabase.from("equipment_categories").insert({ ...row, tenant_id: ctx.tenantId });
    if (error) return { error: friendlyError(error) };
    return done(id ? "Category saved." : "Category added.");
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function saveReminderSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenant("owner");
    const { error } = await ctx.supabase.from("tenant_settings").update({
      reminders_enabled: fd.get("reminders_enabled") === "on",
      quiet_hours_start: optStr(fd, "quiet_hours_start"), quiet_hours_end: optStr(fd, "quiet_hours_end"),
      max_reminders_per_rental: optNum(fd, "max_reminders_per_rental") ?? 5,
    }).eq("tenant_id", ctx.tenantId);
    if (error) return { error: friendlyError(error) };
    for (const kind of ["before_due", "at_due", "overdue", "dispatch_confirmation", "return_confirmation"]) {
      const { error: e } = await ctx.supabase.from("reminder_rules").update({
        enabled: fd.get(`${kind}_enabled`) === "on", offset_minutes: optNum(fd, `${kind}_offset`) ?? 0, template: str(fd, `${kind}_template`),
      }).eq("tenant_id", ctx.tenantId).eq("kind", kind);
      if (e) return { error: friendlyError(e) };
    }
    return done("Reminder settings saved. They apply to rentals dispatched or extended from now on.");
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function saveMessaging(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenant("owner");
    const templates: Record<string, { name: string; language: string; params: string[] }> = {};
    for (const kind of ["before_due", "at_due", "overdue", "dispatch_confirmation", "return_confirmation"]) {
      const name = str(fd, `${kind}_tpl`);
      if (!name) continue;
      if (!/^[a-z0-9_]{1,512}$/.test(name)) return { error: `Template name "${name}" must be lowercase letters, numbers and underscores.` };
      templates[kind] = { name, language: str(fd, `${kind}_lang`) || "en", params: str(fd, `${kind}_params`).split(",").map((s) => s.trim()).filter(Boolean) };
    }
    const mode = str(fd, "mode");
    const db = createAdminClient(); // messaging_connections is not writable by users directly; owner checked above
    const { data: conn } = await db.from("messaging_connections").select("status,phone_number_id").eq("tenant_id", ctx.tenantId).single();
    const { data: cred } = await db.from("messaging_credentials").select("tenant_id").eq("tenant_id", ctx.tenantId).maybeSingle();
    let status = conn?.status ?? "not_connected";
    if (["test", "live"].includes(mode)) {
      if (!conn?.phone_number_id || !cred) return { error: "This workspace has no WhatsApp Business connection yet. See the connection steps below." };
      status = mode;
    } else if (mode === "disabled") status = cred ? "disabled" : "not_connected";
    const { error } = await db.from("messaging_connections").update({
      templates, test_recipient: normalizePhone(optStr(fd, "test_recipient")), status,
    }).eq("tenant_id", ctx.tenantId);
    if (error) return { error: friendlyError(error) };
    return done("WhatsApp settings saved.");
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

// ---- Team ----

export type InviteState = { error?: string; ok?: string; link?: string } | undefined;

export async function addMember(_: InviteState, fd: FormData): Promise<InviteState> {
  try {
    const ctx = await requireTenant("owner");
    const role = str(fd, "role") as Role;
    if (!["owner", "manager", "staff"].includes(role)) return { error: "Choose a role." };
    const { userId, link } = await userWithSetupLink(str(fd, "email"), optStr(fd, "full_name"));
    const db = createAdminClient();
    const { error } = await db.from("tenant_memberships").upsert({ tenant_id: ctx.tenantId, user_id: userId, role, active: true }, { onConflict: "tenant_id,user_id" });
    if (error) return { error: friendlyError(error) };
    revalidatePath("/settings/team");
    return { ok: "Team member added. Send them this one-time setup link (expires in 1 hour):", link };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

async function ownMember(ctxTenant: string, membershipId: string) {
  const db = createAdminClient();
  const { data } = await db.from("tenant_memberships").select("id,user_id,tenant_id").eq("id", membershipId).eq("tenant_id", ctxTenant).maybeSingle();
  if (!data) throw new Error("Member not found");
  return { db, m: data };
}

export async function updateMember(_: InviteState, fd: FormData): Promise<InviteState> {
  try {
    const ctx = await requireTenant("owner");
    const { db, m } = await ownMember(ctx.tenantId, str(fd, "membership_id"));
    const op = str(fd, "op");
    if (op === "link") {
      const { data: p } = await db.from("user_profiles").select("email").eq("id", m.user_id).single();
      return { ok: "One-time password setup link (expires in 1 hour):", link: await setupLink(p!.email) };
    }
    const patch = op === "deactivate" ? { active: false } : op === "activate" ? { active: true } : { role: str(fd, "role") };
    const { error } = await db.from("tenant_memberships").update(patch).eq("id", m.id);
    if (error) return { error: friendlyError(error) };
    revalidatePath("/settings/team");
    return { ok: "Saved." };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
