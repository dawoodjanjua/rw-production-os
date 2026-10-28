"use client";

import { useState, useTransition } from "react";
import { recordReturn, type ReturnDraft } from "../../actions";

type Line = { id: string; description: string; asset_code: string | null; quantity: number; qty_returned: number; qty_missing: number };

export function ReturnForm({ rentalId, lines, nowLocal }: { rentalId: string; lines: Line[]; nowLocal: string }) {
  const outstanding = (l: Line) => l.quantity - l.qty_returned - l.qty_missing;
  const open = lines.filter((l) => outstanding(l) > 0);
  const [d, setD] = useState<ReturnDraft>({
    rental_id: rentalId, returned_local: nowLocal, notes: "",
    lines: open.map((l) => ({ rental_item_id: l.id, returned: outstanding(l), damaged: 0, missing: 0, condition: "" })),
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const upd = (i: number, patch: Partial<ReturnDraft["lines"][number]>) => setD((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const total = d.lines.reduce((s, l) => s + l.returned + l.missing, 0);
  const remaining = open.reduce((s, l) => s + outstanding(l), 0) - total;

  return (
    <div className="space-y-6">
      <div className="card divide-y divide-line">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <h2 className="text-sm font-semibold">Items still out</h2>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => setD((x) => ({ ...x, lines: x.lines.map((l, i) => ({ ...l, returned: outstanding(open[i]), missing: 0, damaged: 0 })) }))}>All returned</button>
            <button type="button" className="btn-ghost text-xs" onClick={() => setD((x) => ({ ...x, lines: x.lines.map((l) => ({ ...l, returned: 0, missing: 0, damaged: 0 })) }))}>Clear</button>
          </div>
        </div>
        {open.map((l, i) => {
          const max = outstanding(l);
          const v = d.lines[i];
          const invalid = v.returned + v.missing > max || v.damaged > v.returned;
          return (
            <div key={l.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_repeat(3,90px)_1fr]">
              <div><div className="font-medium">{l.description}</div><div className="text-xs text-muted">{l.asset_code ?? ""} · {max} outstanding</div></div>
              <label><span className="label">Returned</span><input type="number" min={0} max={max} value={v.returned} onChange={(e) => upd(i, { returned: Math.max(0, Number(e.target.value) || 0) })} className="input" /></label>
              <label><span className="label">of which damaged</span><input type="number" min={0} max={v.returned} value={v.damaged} onChange={(e) => upd(i, { damaged: Math.max(0, Number(e.target.value) || 0) })} className="input" /></label>
              <label><span className="label">Missing</span><input type="number" min={0} max={max} value={v.missing} onChange={(e) => upd(i, { missing: Math.max(0, Number(e.target.value) || 0) })} className="input" /></label>
              <label><span className="label">Condition notes</span><input value={v.condition} onChange={(e) => upd(i, { condition: e.target.value })} className="input" placeholder="OK / scratch on lens hood…" /></label>
              {invalid && <p className="text-xs text-red-700 sm:col-span-5">Returned + missing cannot exceed {max}; damaged cannot exceed returned.</p>}
            </div>
          );
        })}
      </div>
      <div className="card grid gap-4 p-4 sm:grid-cols-2">
        <label><span className="label">Return date & time</span><input type="datetime-local" value={d.returned_local} onChange={(e) => setD({ ...d, returned_local: e.target.value })} className="input" /></label>
        <label><span className="label">Notes</span><input value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} className="input" /></label>
        <p className="text-sm text-muted sm:col-span-2">
          {remaining <= 0 ? "All equipment will be accounted for: the rental becomes Returned and pending reminders are cancelled." : `${remaining} unit(s) will remain out (partial return).`}
          {" "}Damaged units go out of service; missing units are recorded as missing. Late fees are applied only if your company settings define one.
        </p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <button type="button" disabled={pending || total === 0} className="btn-primary"
        onClick={() => start(async () => { setError(null); const r = await recordReturn(d); if (r?.error) setError(r.error); })}>
        {pending ? "Saving…" : "Confirm return"}
      </button>
    </div>
  );
}
