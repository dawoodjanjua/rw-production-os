"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { createRental, quoteRental, type Quote, type RentalDraft } from "../actions";

type Item = { id: string; name: string; code: string | null; tracking: "bulk" | "serialized"; category_name: string | null; qty_available: number; effective_shift_rate: number | null; effective_day_rate: number | null };
type Asset = { id: string; item_id: string; asset_code: string; serial_number: string | null };
type Shift = { id: string; name: string; start_time: string; end_time: string; rate_multiplier: number };
type Client = { id: string; name: string; contact_person: string | null; whatsapp: string | null };

const fmt = (n: number, cur: string) => `${cur} ${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const clock = (t: string) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };

export function DispatchForm({ clients, items, assets, shifts, currency, tz, nowLocal, todayLocal, canOverride, defaultClient }: {
  clients: Client[]; items: Item[]; assets: Asset[]; shifts: Shift[]; currency: string; tz: string; nowLocal: string; todayLocal: string; canOverride: boolean; defaultClient?: string;
}) {
  const [d, setD] = useState<RentalDraft>({
    client_id: defaultClient ?? "", rental_type: shifts.length ? "shift" : "full_day", shift_rule_id: shifts[0]?.id, shift_date: undefined,
    units: 1, start_local: nowLocal, dispatch_now: true, items: [],
  });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [picker, setPicker] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof RentalDraft>(k: K, v: RentalDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Live quote from the database (single source of truth for deadline and pricing).
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await quoteRental(d);
      setQuote(r.quote ?? null);
      setQuoteError(r.error ?? null);
    }, 300);
    return () => clearTimeout(t);
  }, [d]);

  const client = clients.find((c) => c.id === d.client_id);
  const addItem = (id: string) => {
    if (!id || d.items.some((x) => x.item_id === id)) return;
    set("items", [...d.items, { item_id: id, quantity: 1, asset_ids: [] }]);
    setPicker("");
  };
  const updateLine = (idx: number, patch: Partial<RentalDraft["items"][number]>) =>
    set("items", d.items.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const submit = () => start(async () => {
    setSubmitError(null);
    const r = await createRental(d);
    if (r?.error) setSubmitError(r.error);
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <section className="card grid gap-4 p-4 sm:grid-cols-2">
          <h2 className="text-sm font-semibold sm:col-span-2">Rental details</h2>
          <label className="sm:col-span-2"><span className="label">Client *</span>
            <div className="flex gap-2">
              <select value={d.client_id} onChange={(e) => {
                const c = clients.find((x) => x.id === e.target.value);
                setD((x) => ({ ...x, client_id: e.target.value, responsible_name: x.responsible_name || c?.contact_person || "", responsible_whatsapp: x.responsible_whatsapp || c?.whatsapp || "" }));
              }} className="input">
                <option value="">Select client…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <Link href="/clients/new?return_to=/rentals/new" className="btn-secondary">New</Link>
            </div>
          </label>
          <label><span className="label">Project / shoot</span><input value={d.project_name ?? ""} onChange={(e) => set("project_name", e.target.value)} className="input" placeholder="Brand film shoot" /></label>
          <label><span className="label">Shoot location</span><input value={d.location ?? ""} onChange={(e) => set("location", e.target.value)} className="input" placeholder="DHA Phase 6, Lahore" /></label>
          <label><span className="label">Responsible person</span><input value={d.responsible_name ?? ""} onChange={(e) => set("responsible_name", e.target.value)} className="input" /></label>
          <label><span className="label">Their WhatsApp</span><input value={d.responsible_whatsapp ?? ""} onChange={(e) => set("responsible_whatsapp", e.target.value)} className="input" placeholder={client?.whatsapp ?? "0300 1234567"} /></label>
        </section>

        <section className="card grid gap-4 p-4 sm:grid-cols-2">
          <h2 className="text-sm font-semibold sm:col-span-2">Schedule & rental type</h2>
          <div className="grid grid-cols-3 gap-2 sm:col-span-2">
            {([["shift", "Shift"], ["full_day", "Full day"], ["custom", "Custom"]] as const).map(([v, l]) => (
              <button type="button" key={v} disabled={v === "shift" && !shifts.length} onClick={() => set("rental_type", v)}
                className={`rounded-lg border px-3 py-2 text-sm ${d.rental_type === v ? "border-brand bg-brand/5 font-medium text-brand" : "border-line text-muted"} disabled:opacity-40`}>{l}</button>
            ))}
          </div>
          <label><span className="label">Dispatch date & time</span><input type="datetime-local" value={d.start_local} onChange={(e) => set("start_local", e.target.value)} className="input" /></label>
          {d.rental_type === "shift" && <>
            <label><span className="label">Shift</span>
              <select value={d.shift_rule_id} onChange={(e) => set("shift_rule_id", e.target.value)} className="input">
                {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} · {clock(s.start_time)}–{clock(s.end_time)}{Number(s.rate_multiplier) !== 1 ? ` · ×${s.rate_multiplier}` : ""}</option>)}
              </select></label>
            <label><span className="label">First shift date</span><input type="date" value={d.shift_date || quote?.shift_date || todayLocal} onChange={(e) => set("shift_date", e.target.value)} className="input" />
              <span className="mt-1 block text-xs text-muted">{d.shift_date ? <button type="button" className="link" onClick={() => set("shift_date", undefined)}>Use next available shift</button> : "Automatic: the next shift that has not ended yet."}</span></label>
            <label><span className="label">Number of shifts</span><input type="number" min={1} max={366} value={d.units} onChange={(e) => set("units", Math.max(1, Number(e.target.value) || 1))} className="input" /></label>
          </>}
          {d.rental_type === "full_day" && (
            <label><span className="label">Number of days</span><input type="number" min={1} max={366} value={d.units} onChange={(e) => set("units", Math.max(1, Number(e.target.value) || 1))} className="input" /></label>
          )}
          {d.rental_type === "custom" && (
            <label><span className="label">Return deadline</span><input type="datetime-local" value={d.custom_return_local ?? ""} onChange={(e) => set("custom_return_local", e.target.value)} className="input" />
              <span className="mt-1 block text-xs text-muted">Billed per started 24 hours at the day rate.</span></label>
          )}
          <p className="text-xs text-muted sm:col-span-2">Times are in {tz}. Full-day rentals end 24 hours (per day) after dispatch; shift rentals end at the shift end time.</p>
        </section>

        <section className="card">
          <div className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold">Equipment</h2>
            <select value={picker} onChange={(e) => addItem(e.target.value)} className="input sm:w-80">
              <option value="">+ Add equipment…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id} disabled={i.qty_available < 1 || d.items.some((x) => x.item_id === i.id)}>
                  {i.name}{i.code ? ` (${i.code})` : ""} — {i.qty_available} available
                </option>
              ))}
            </select>
          </div>
          {d.items.length === 0 ? <p className="p-6 text-center text-sm text-muted">No equipment added yet.</p> : (
            <div className="divide-y divide-line">
              {d.items.map((l, idx) => {
                const it = itemById.get(l.item_id)!;
                const q = quote?.lines.find((x) => x.item_id === l.item_id);
                const itemAssets = assets.filter((a) => a.item_id === l.item_id);
                return (
                  <div key={l.item_id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{it.name}</div>
                        <div className="text-xs text-muted">{[it.code, it.category_name, `${it.qty_available} available`].filter(Boolean).join(" · ")}</div>
                      </div>
                      <button type="button" onClick={() => set("items", d.items.filter((_, i) => i !== idx))} className="btn-ghost px-2" aria-label="Remove"><Trash2 size={16} /></button>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      {it.tracking === "bulk" ? (
                        <label><span className="label">Quantity</span><input type="number" min={1} max={it.qty_available} value={l.quantity} onChange={(e) => updateLine(idx, { quantity: Math.max(1, Number(e.target.value) || 1) })} className="input" /></label>
                      ) : (
                        <div className="sm:col-span-2"><span className="label">Units (asset codes)</span>
                          <div className="flex flex-wrap gap-2">
                            {itemAssets.map((a) => {
                              const on = l.asset_ids?.includes(a.id);
                              return (
                                <button type="button" key={a.id} onClick={() => {
                                  const ids = on ? l.asset_ids!.filter((x) => x !== a.id) : [...(l.asset_ids ?? []), a.id];
                                  updateLine(idx, { asset_ids: ids, quantity: Math.max(1, ids.length) });
                                }} className={`rounded-md border px-2 py-1 text-xs ${on ? "border-brand bg-brand text-white" : "border-line"}`}>{a.asset_code}</button>
                              );
                            })}
                          </div>
                          {!l.asset_ids?.length && <span className="mt-1 block text-xs text-muted">None selected: 1 available unit will be assigned automatically.</span>}
                        </div>
                      )}
                      {canOverride && (
                        <label><span className="label">Rate override ({currency})</span><input inputMode="decimal" value={l.unit_rate_override ?? ""} onChange={(e) => updateLine(idx, { unit_rate_override: e.target.value })} className="input" placeholder={q ? String(q.unit_rate) : "Standard"} /></label>
                      )}
                    </div>
                    {q && <div className="mt-2 text-xs text-muted">{fmt(q.unit_rate, currency)} × {q.units} {quote?.billing_basis === "shift" ? "shift(s)" : "day(s)"} × {q.quantity} = <span className="font-medium text-ink">{fmt(q.line_total, currency)}</span> <span>({q.rate_source})</span></div>}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="card grid gap-4 p-4 sm:grid-cols-2">
          <h2 className="text-sm font-semibold sm:col-span-2">Payment & condition</h2>
          <label><span className="label">Deposit / advance received ({currency})</span><input inputMode="decimal" value={d.deposit_amount ?? ""} onChange={(e) => set("deposit_amount", e.target.value)} className="input" placeholder="0" /></label>
          {canOverride && <label><span className="label">Discount ({currency})</span><input inputMode="decimal" value={d.discount_amount ?? ""} onChange={(e) => set("discount_amount", e.target.value)} className="input" placeholder="0" /></label>}
          <label className="sm:col-span-2"><span className="label">Condition at dispatch</span><input value={d.dispatch_condition ?? ""} onChange={(e) => set("dispatch_condition", e.target.value)} className="input" placeholder="All items checked and working" /></label>
          <label className="sm:col-span-2"><span className="label">Notes</span><textarea rows={2} value={d.notes ?? ""} onChange={(e) => set("notes", e.target.value)} className="input" /></label>
        </section>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="card p-4">
          <h2 className="text-sm font-semibold">Summary</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-muted">Client</dt><dd className="text-right">{client?.name ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Type</dt><dd>{d.rental_type === "shift" ? `${quote?.units ?? d.units} shift(s)` : d.rental_type === "full_day" ? `${d.units} day(s)` : quote ? `Custom · ${quote.units} day(s)` : "Custom"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Return deadline</dt>
              <dd className="text-right font-medium">{quote ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(quote.expected_return_at)) : "—"}</dd></div>
            <div className="flex justify-between gap-2 border-t border-line pt-2"><dt className="text-muted">Equipment subtotal</dt><dd className="tabular-nums">{quote ? fmt(quote.subtotal, currency) : "—"}</dd></div>
            {Number(d.discount_amount || 0) > 0 && <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd className="tabular-nums">−{fmt(Number(d.discount_amount), currency)}</dd></div>}
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Estimated total</dt><dd className="tabular-nums">{quote ? fmt(Math.max(0, quote.subtotal - Number(d.discount_amount || 0)), currency) : "—"}</dd></div>
          </dl>
          {quoteError && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{quoteError}</p>}
          <div className="mt-4 space-y-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.dispatch_now} onChange={(e) => set("dispatch_now", e.target.checked)} className="accent-[var(--brand)]" />Equipment leaves now (dispatch)</label>
            <p className="text-xs text-muted">{d.dispatch_now ? "Stock is marked as on rent and return reminders are scheduled." : "Creates a reservation that holds the stock until it is dispatched or cancelled."}</p>
          </div>
          {submitError && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{submitError}</p>}
          <button type="button" onClick={submit} disabled={pending || !d.client_id || d.items.length === 0 || !!quoteError} className="btn-primary mt-4 w-full">
            {pending ? "Saving…" : d.dispatch_now ? "Confirm dispatch" : "Save reservation"}
          </button>
        </div>
      </aside>
    </div>
  );
}
