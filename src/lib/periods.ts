import { fromLocalInput, todayInTz } from "@/lib/format";

export const PERIODS = [["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["90d", "Last 90 days"], ["year", "This year"]] as const;

/** [fromISO, toISO) for a named period, with day boundaries in the tenant timezone. */
export function periodRange(period: string, tz: string, from?: string, to?: string): { from: string; to: string; label: string } {
  const today = todayInTz(tz);
  const dayStart = (d: string) => fromLocalInput(`${d}T00:00`, tz);
  const addDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  const end = dayStart(addDays(today, 1));
  if (period === "custom" && from && to) return { from: dayStart(from), to: dayStart(addDays(to, 1)), label: `${from} → ${to}` };
  if (period === "month") return { from: dayStart(today.slice(0, 8) + "01"), to: end, label: "This month" };
  if (period === "year") return { from: dayStart(today.slice(0, 5) + "01-01"), to: end, label: "This year" };
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  return { from: dayStart(addDays(today, -(days - 1))), to: end, label: PERIODS.find((p) => p[0] === period)?.[1] ?? "Last 30 days" };
}
