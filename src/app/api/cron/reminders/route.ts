import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { processDueReminders } from "@/lib/messaging/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest) {
  const secret = env.cronSecret();
  if (secret.length < 24) return false; // refuse to run without a strong secret
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.nextUrl.searchParams.get("key") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Called every 1–5 minutes by an external scheduler (see docs/DEPLOYMENT.md). */
async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const summary = await processDueReminders({ limit: 100 });
    return NextResponse.json({ ok: true, at: new Date().toISOString(), live_sending: env.whatsappSendEnabled(), ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
