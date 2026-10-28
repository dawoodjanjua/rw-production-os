/** Manual WhatsApp handoff helpers (no API required). */

export function waLink(e164: string, message: string) {
  const digits = e164.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** Replace {placeholders}; unknown placeholders are left empty. */
export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>) {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] ?? "").toString()).replace(/[ \t]+\n/g, "\n").trim();
}

export function invoiceMessage(v: { client: string; company: string; number: string; total: string; balance: string; due: string; project?: string | null; instructions?: string | null; phone?: string | null }) {
  return [
    `Assalam-o-Alaikum ${v.client},`,
    ``,
    `Please find invoice ${v.number} from ${v.company}${v.project ? ` for ${v.project}` : ""}.`,
    `Total: ${v.total}`,
    `Balance due: ${v.balance}`,
    `Due date: ${v.due}`,
    v.instructions ? `\n${v.instructions}` : "",
    ``,
    `The PDF invoice is attached. Thank you!`,
    v.phone ? `${v.company} · ${v.phone}` : v.company,
  ].filter((l) => l !== "").join("\n").replace(/\n{3,}/g, "\n\n");
}

export function rentalMessage(v: { client: string; company: string; reference: string; items: string; due: string; total: string; phone?: string | null }) {
  return [
    `Assalam-o-Alaikum ${v.client},`,
    ``,
    `${v.company} rental ${v.reference}`,
    `Equipment: ${v.items}`,
    `Return by: ${v.due}`,
    `Rental total: ${v.total}`,
    ``,
    `Please return all equipment by the deadline. Thank you!`,
    v.phone ? `${v.company} · ${v.phone}` : v.company,
  ].join("\n");
}
