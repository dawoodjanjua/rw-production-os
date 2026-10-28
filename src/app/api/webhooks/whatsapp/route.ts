import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Meta webhook verification handshake. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = env.whatsappVerifyToken();
  if (token && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === token) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

/** Delivery-status updates. Signature-verified with the Meta app secret. */
export async function POST(req: NextRequest) {
  const secret = env.whatsappAppSecret();
  if (!secret) return new NextResponse("not configured", { status: 503 });
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return new NextResponse("invalid signature", { status: 401 });
  }
  const payload = JSON.parse(raw) as { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string }; statuses?: { id: string; status: string; timestamp: string; errors?: { title?: string; message?: string }[] }[] } }[] }[] };
  const db = createAdminClient();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const phoneNumberId = change.value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const { data: conn } = await db.from("messaging_connections").select("tenant_id").eq("phone_number_id", phoneNumberId).maybeSingle();
      if (!conn) continue;
      for (const st of change.value?.statuses ?? []) {
        if (!(st.status in RANK)) continue;
        const { data: log } = await db.from("message_logs").select("id,status").eq("provider_message_id", st.id).eq("tenant_id", conn.tenant_id).maybeSingle();
        if (!log || (RANK[log.status] ?? -1) >= RANK[st.status]) continue; // never downgrade (read → delivered)
        const at = new Date(Number(st.timestamp) * 1000).toISOString();
        await db.from("message_logs").update({
          status: st.status,
          ...(st.status === "sent" ? { sent_at: at } : {}),
          ...(st.status === "delivered" ? { delivered_at: at } : {}),
          ...(st.status === "read" ? { read_at: at } : {}),
          ...(st.status === "failed" ? { failed_at: at, error: st.errors?.map((e) => e.message ?? e.title).join("; ") } : {}),
        }).eq("id", log.id);
      }
    }
  }
  return NextResponse.json({ ok: true });
}
