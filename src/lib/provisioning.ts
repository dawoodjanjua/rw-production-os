import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

/**
 * Find or create an auth user (no password) and return a one-time setup link they use to choose a password.
 * No default or shared passwords are ever created. Links expire (Supabase OTP expiry, 1 hour by default).
 */
export async function userWithSetupLink(email: string, fullName?: string | null) {
  const db = createAdminClient();
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Enter a valid email address.");
  let created = false;
  const { data: existing } = await db.from("user_profiles").select("id").ilike("email", normalized).maybeSingle();
  let userId = existing?.id as string | undefined;
  if (!userId) {
    const { data, error } = await db.auth.admin.createUser({ email: normalized, email_confirm: true, user_metadata: { full_name: fullName ?? "" } });
    if (error) throw new Error(error.message);
    userId = data.user.id;
    created = true;
    if (fullName) await db.from("user_profiles").update({ full_name: fullName }).eq("id", userId);
  }
  const link = await setupLink(normalized);
  return { userId: userId!, created, link };
}

export async function setupLink(email: string) {
  const db = createAdminClient();
  const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email });
  if (error) throw new Error(error.message);
  const hashed = data.properties.hashed_token;
  return `${env.siteUrl()}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=recovery&next=/set-password`;
}
