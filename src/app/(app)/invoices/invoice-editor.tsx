"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveInvoice, type InvoiceDraft } from "./actions";

export function InvoiceEditor({ initial, clients, rentals, currency }: {
  initial: InvoiceDraft; clients: { id: string; name: string }[]; rentals: { id: string; reference: string; client_id: string; project_name: string | null }[]; currency: string;
}) {
  const [d, setD] = useState<InvoiceDraft>(initial.items.length ? initial : { ...initial, items: [{ description: "", quantity: "1", unit_price: "" }] });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof InvoiceDraft>(k: K, v: InvoiceDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const num = (s: string | undefined) => Number(String(s ?? "").replace(/,/g, "")) || 0;
  const sub = d.items.reduce((s, i) => s + Math.round(num(i.quantity) * num(i.unit_price) * 100) / 100, 0);
  const taxable = Math.max(sub - num(d.discount_amount), 0);
  const tax = Math.round(taxable * num(d.tax_rate) / 100 * 100) / 100;
  const fmt = (n: number) => `${currency} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      <section className="card grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="sm:col-span-2"><span className="label">Client *</span>
          <select value={d.client_id} onChange={(e) => set("client_id", e.target.value)} className="input">
            <option value="">Select client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label className="sm:col-span-2"><span className="label">Related rental</span>
          <select value={d.rental_id ?? ""} onChange={(e) => { const r = rentals.find((x) => x.id === e.target.value); setD((x) => ({ ...x, rental_id: e.target.value, project_name: x.project_name || r?.project_name || "" })); }} className="input" disabled={!d.client_id}>
            <option value="">None</option>{rentals.filter((r) => r.client_id === d.client_id).map((r) => <option key={r.id} value={r.id}>{r.reference}{r.project_name ? ` · ${r.project_name}` : ""}</option>)}
          </select></label>
        <label className="sm:col-span-2"><span className="label">Project</span><input value={d.project_name ?? ""} onChange={(e) => set("project_name", e.target.value)} className="input" /></label>
        <label><span className="label">Issue date</span><input type="date" value={d.issue_date ?? ""} onChange={(e) => set("issue_date", e.target.value)} className="input" /></label>
        <label><span className="label">Due date</span><input type="date" value={d.due_date ?? ""} onChange={(e) => set("due_date", e.target.value)} className="input" /></label>
      </section>

      <section className="card">
        <div className="border-b border-line p-4 text-sm font-semibold">Line items</div>
        <div className="divide-y divide-line">
          {d.items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-2 p-3 sm:grid-cols-[1fr_90px_140px_120px_auto] sm:items-center">
              <input value={it.description} onChange={(e) => set("items", d.items.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} placeholder="Description" className="input col-span-2 sm:col-span-1" />
              <input value={it.quantity} inputMode="decimal" onChange={(e) => set("items", d.items.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} placeholder="Qty" className="input" aria-label="Quantity" />
              <input value={it.unit_price} inputMode="decimal" onChange={(e) => set("items", d.items.map((x, j) => j === i ? { ...x, unit_price: e.target.value } : x))} placeholder="Unit price" className="input" aria-label="Unit price" />
              <div className="text-right text-sm tabular-nums">{fmt(Math.round(num(it.quantity) * num(it.unit_price) * 100) / 100)}</div>
              <button type="button" onClick={() => set("items", d.items.filter((_, j) => j !== i))} className="btn-ghost px-2" aria-label="Remove line"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <div className="border-t border-line p-3"><button type="button" onClick={() => set("items", [...d.items, { description: "", quantity: "1", unit_price: "" }])} className="btn-ghost"><Plus size={16} />Add line</button></div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card grid gap-4 p-4">
          <label><span className="label">Notes</span><textarea rows={2} value={d.notes ?? ""} onChange={(e) => set("notes", e.target.value)} className="input" /></label>
          <label><span className="label">Payment instructions</span><textarea rows={3} value={d.payment_instructions ?? ""} onChange={(e) => set("payment_instructions", e.target.value)} className="input" /></label>
        </div>
        <div className="card space-y-3 p-4 text-sm">
          <div className="flex justify-between"><span className="text-muted">Subtotal</span><span className="tabular-nums">{fmt(sub)}</span></div>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Discount ({currency})</span><input value={d.discount_amount ?? ""} inputMode="decimal" onChange={(e) => set("discount_amount", e.target.value)} className="input w-36 text-right" placeholder="0" /></label>
          <label className="flex items-center justify-between gap-3"><span className="text-muted">Tax rate (%)</span><input value={d.tax_rate ?? ""} inputMode="decimal" onChange={(e) => set("tax_rate", e.target.value)} className="input w-36 text-right" placeholder="0" /></label>
          <div className="flex justify-between"><span className="text-muted">Tax</span><span className="tabular-nums">{fmt(tax)}</span></div>
          <div className="flex justify-between border-t border-line pt-3 text-base font-semibold"><span>Total</span><span className="tabular-nums">{fmt(taxable + tax)}</span></div>
        </div>
      </section>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <button type="button" disabled={pending} onClick={() => start(async () => { setError(null); const r = await saveInvoice(d); if (r?.error) setError(r.error); })} className="btn-primary">
        {pending ? "Saving…" : "Save draft"}
      </button>
    </div>
  );
}
