/**
 * Create (or promote) a platform administrator and print a one-time password setup link.
 *
 *   npm run admin:create -- admin@yourcompany.com "Your Name"
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SITE_URL from the environment
 * (or .env.local). Run it from your own computer; never expose the service role key in a browser.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: process.env.ENV_FILE ?? ".env.local" });
const [email, name] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run admin:create -- admin@example.com "Full Name"');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const site = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
if (!url || !key) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const normalized = email.trim().toLowerCase();
  const { data: existing } = await db.from("user_profiles").select("id").ilike("email", normalized).maybeSingle();
  let id = existing?.id as string | undefined;
  if (!id) {
    const { data, error } = await db.auth.admin.createUser({ email: normalized, email_confirm: true, user_metadata: { full_name: name ?? "" } });
    if (error) throw error;
    id = data.user.id;
  }
  const { error } = await db.from("platform_admins").upsert({ user_id: id });
  if (error) throw error;
  const { data: link, error: e2 } = await db.auth.admin.generateLink({ type: "recovery", email: normalized });
  if (e2) throw e2;
  console.log(`\nPlatform admin ready: ${normalized}`);
  console.log(`\nOpen this one-time link within 1 hour to set the password:\n${site}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=recovery&next=/set-password\n`);
  console.log(`Then go to ${site}/admin to create the first company workspace.\n`);
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
