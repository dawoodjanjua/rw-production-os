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
  const ok = Object.values(present).every(Boolean) && database === "reachable";
  return NextResponse.json({ ok, settings: present, supabase: database }, { status: ok ? 200 : 503 });
}
