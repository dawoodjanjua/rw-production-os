import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS — use ONLY after an explicit server-side authorization check
 * (platform admin console, owner team management, scheduler, webhooks). Never import in client code.
 */
export function createAdminClient() {
  return createClient(env.supabaseUrl(), env.serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
