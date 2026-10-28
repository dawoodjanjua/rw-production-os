export function money(amount: number | string | null | undefined, currency = "PKR") {
  const n = Number(amount ?? 0);
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function compactMoney(amount: number | string | null | undefined, currency = "PKR") {
  const n = Number(amount ?? 0);
  if (Math.abs(n) >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(n) >= 10_000) return `${currency} ${Math.round(n / 1000)}k`;
  return money(n, currency);
}

export function dateTime(value: string | Date | null | undefined, tz: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value));
}

export function date(value: string | Date | null | undefined, tz?: string) {
  if (!value) return "—";
  // Plain dates (YYYY-MM-DD) are calendar dates; don't shift them by timezone.
  const d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T12:00:00Z") : new Date(value);
  return new Intl.DateTimeFormat("en-GB", { timeZone: typeof value === "string" && value.length === 10 ? "UTC" : tz, day: "2-digit", month: "short", year: "numeric" }).format(d);
}

export function time(value: string | Date | null | undefined, tz: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value));
}

/** "HH:MM:SS" → "11:00 AM" */
export function clock(t: string | null | undefined) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ap}`;
}

/** Value for <input type="datetime-local"> in the tenant timezone. */
export function toLocalInput(value: string | Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(value)).reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
}

/** Interpret "YYYY-MM-DDTHH:MM" as wall-clock time in tz and return an ISO instant. DST-safe. */
export function fromLocalInput(local: string, tz: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) throw new Error("Invalid date/time");
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (t: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hour12: false })
      .formatToParts(new Date(t)).reduce<Record<string, number>>((a, x) => (x.type !== "literal" && (a[x.type] = Number(x.value)), a), {});
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - t;
  };
  let ts = guess - offset(guess);
  ts = guess - offset(ts);
  return new Date(ts).toISOString();
}

export function todayInTz(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export const STATUS_LABEL: Record<string, string> = {
  reserved: "Reserved", dispatched: "On rent", partially_returned: "Partly returned", returned: "Returned",
  overdue: "Overdue", cancelled: "Cancelled", closed: "Closed", draft: "Draft", issued: "Issued",
  partially_paid: "Partly paid", paid: "Paid", void: "Void", available: "Available", maintenance: "Maintenance",
  damaged: "Damaged", missing: "Missing", retired: "Retired", scheduled: "Scheduled", processing: "Processing",
  sent: "Sent", dry_run: "Dry run (not sent)", skipped: "Skipped", failed: "Failed", opened: "WhatsApp opened (not confirmed)",
  prepared: "Prepared", queued: "Queued", delivered: "Delivered", read: "Read",
};
