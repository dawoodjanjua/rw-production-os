import "server-only";
import { env } from "@/lib/env";
import type { MessagingProvider, SendResult, TemplateMessage } from "./provider";
import { sanitizeParam } from "./provider";

/** Official WhatsApp Business Platform (Cloud API) client for one tenant's phone number. */
export class WhatsAppCloudProvider implements MessagingProvider {
  constructor(private phoneNumberId: string, private accessToken: string) {}

  async sendTemplate(msg: TemplateMessage): Promise<SendResult> {
    if (!/^\+[1-9]\d{6,14}$/.test(msg.to)) return { ok: false, error: "Invalid recipient number", transient: false };
    const url = `https://graph.facebook.com/${env.whatsappApiVersion()}/${encodeURIComponent(this.phoneNumberId)}/messages`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: msg.to.replace("+", ""),
          type: "template",
          template: {
            name: msg.templateName,
            language: { code: msg.language },
            components: msg.bodyParams.length ? [{ type: "body", parameters: msg.bodyParams.map((t) => ({ type: "text", text: sanitizeParam(t) })) }] : [],
          },
        }),
        signal: AbortSignal.timeout(15000),
      });
      const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
      if (res.ok && json.messages?.[0]?.id) return { ok: true, providerMessageId: json.messages[0].id };
      const transient = res.status >= 500 || res.status === 429 || json.error?.code === 130429 || json.error?.code === 131000;
      return { ok: false, error: `WhatsApp API ${res.status}: ${json.error?.message ?? "unknown error"}`, transient };
    } catch (e) {
      return { ok: false, error: `Network error: ${(e as Error).message}`, transient: true };
    }
  }
}
