/**
 * Messaging provider boundary. The rental workflow only talks to this interface, so the official
 * WhatsApp Business Platform (or another approved provider) can be swapped in without rewriting it.
 */
export type TemplateMessage = {
  to: string;               // E.164
  templateName: string;     // approved utility template name
  language: string;         // e.g. "en"
  bodyParams: string[];     // {{1}}, {{2}}, … in order
};

export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; transient: boolean };

export interface MessagingProvider {
  sendTemplate(msg: TemplateMessage): Promise<SendResult>;
}

/** Template parameter rules from the WhatsApp Cloud API: non-empty, no newlines/tabs, no 4+ spaces, max 1024 chars. */
export function sanitizeParam(v: string) {
  const s = v.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 1024);
  return s || "-";
}
