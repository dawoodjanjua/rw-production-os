import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Deployment check: reports which required settings are present (never their values). */
export async function GET() {
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SITE_URL", "CRON_SECRET", "MESSAGING_ENCRYPTION_KEY"];
  const present = Object.fromEntries(names.map((n) => [n, !!process.env[n]]));
  let database = "not checked";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    try {
      const r = await fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: key }, signal: AbortSignal.timeout(8000) });
      database = r.ok ? "reachable" : `error ${r.status}`;
    } catch (e) {
      database = `unreachable: ${(e as Error).message}`;
    }
  }
  // Server key check: only a secret (service role) key may call the reminder claim function. Limit 0 = no side effects.
  let serverKey = "not checked";
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && secret) {
    if (secret === key) serverKey = "invalid: same as the public anon/publishable key";
    else {
      try {
        const base = url.replace(/\/$/, "");
        const auth = await fetch(`${base}/auth/v1/admin/users?per_page=1`, { headers: { apikey: secret, Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000) });
        const rpc = await fetch(`${base}/rest/v1/rpc/claim_due_reminders`, { method: "POST", headers: { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_limit: 0 }), signal: AbortSignal.timeout(8000) });
        serverKey = !auth.ok ? `invalid: admin API answered ${auth.status} (use the secret / service_role key)`
          : rpc.ok ? "valid" : `key valid, database permission missing (${rpc.status}): run the latest migration`;
      } catch (e) {
        serverKey = `unreachable: ${(e as Error).message}`;
      }
    }
  }
  const ok = Object.values(present).every(Boolean) && database === "reachable" && serverKey === "valid";
  return NextResponse.json({ ok, settings: present, supabase: database, server_key: serverKey }, { status: ok ? 200 : 503 });
}
