"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/messaging/crypto";
import { userWithSetupLink } from "@/lib/provisioning";
import { friendlyError, optStr, str } from "@/lib/actions";

export type AdminState = { error?: string; ok?: string; link?: string } | undefined;

/** Create a tenant workspace and its owner. The owner receives a one-time setup link (no shared password). */
export async function createTenant(_: AdminState, fd: FormData): Promise<AdminState> {
  try {
    await requirePlatformAdmin();
    const name = str(fd, "name");
    const slug = str(fd, "slug").toLowerCase() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (name.length < 2) return { error: "Company name is required." };
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) return { error: "Workspace ID must be 3–50 lowercase letters, numbers or dashes." };
    const { userId, link } = await userWithSetupLink(str(fd, "owner_email"), optStr(fd, "owner_name"));
    const db = createAdminClient();
    const { error } = await db.rpc("provision_tenant", { p_name: name, p_slug: slug, p_owner: userId, p_plan: str(fd, "plan") || "starter" });
    if (error) return { error: friendlyError(error) };
    revalidatePath("/admin");
    return { ok: `Workspace "${name}" created. Send the owner this one-time setup link (expires in 1 hour). They can request a new one from “Forgot password” if it expires:`, link };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function updateTenant(_: AdminState, fd: FormData): Promise<AdminState> {
  try {
    await requirePlatformAdmin();
    const db = createAdminClient();
    const { error } = await db.from("tenants").update({ plan: str(fd, "plan"), status: str(fd, "status"), plan_notes: optStr(fd, "plan_notes") }).eq("id", str(fd, "id"));
    if (error) return { error: friendlyError(error) };
    revalidatePath("/admin");
    return { ok: "Saved." };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

/** Store a tenant's WhatsApp Cloud API connection. The access token is encrypted and never returned to any browser. */
export async function connectWhatsApp(_: AdminState, fd: FormData): Promise<AdminState> {
  try {
    await requirePlatformAdmin();
    const tenantId = str(fd, "tenant_id");
    const db = createAdminClient();
    const token = str(fd, "access_token");
    const phoneNumberId = str(fd, "phone_number_id");
    if (!/^\d{5,30}$/.test(phoneNumberId)) return { error: "Phone number ID must be the numeric ID from WhatsApp Manager." };
    if (token) {
      const { error } = await db.from("messaging_credentials").upsert({ tenant_id: tenantId, access_token_encrypted: encryptSecret(token), token_last4: token.slice(-4), updated_at: new Date().toISOString() });
      if (error) return { error: friendlyError(error) };
    }
    const { data: cred } = await db.from("messaging_credentials").select("tenant_id").eq("tenant_id", tenantId).maybeSingle();
    if (!cred) return { error: "Enter the access token." };
    const { error } = await db.from("messaging_connections").upsert({
      tenant_id: tenantId, provider: "whatsapp_cloud", phone_number_id: phoneNumberId, waba_id: optStr(fd, "waba_id"),
      display_phone_number: optStr(fd, "display_phone_number"), connected_at: new Date().toISOString(), status: "disabled", last_error: null,
    });
    if (error) return { error: friendlyError(error) };
    revalidatePath(`/admin/tenants/${tenantId}`);
    return { ok: "Connection saved (sending mode is Off). The owner can now switch to Test mode in Settings → WhatsApp." };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function disconnectWhatsApp(_: AdminState, fd: FormData): Promise<AdminState> {
  await requirePlatformAdmin();
  const db = createAdminClient();
  const tenantId = str(fd, "tenant_id");
  await db.from("messaging_credentials").delete().eq("tenant_id", tenantId);
  await db.from("messaging_connections").update({ status: "not_connected", phone_number_id: null, waba_id: null, display_phone_number: null, connected_at: null }).eq("tenant_id", tenantId);
  revalidatePath(`/admin/tenants/${tenantId}`);
  return { ok: "Disconnected and credentials deleted." };
}
