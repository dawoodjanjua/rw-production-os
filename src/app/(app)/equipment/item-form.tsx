"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { saveItem } from "./actions";

type Item = Record<string, unknown> & { id?: string; tracking?: string };

export function ItemForm({ item, categories, suppliers, currency }: { item?: Item; categories: { id: string; name: string }[]; suppliers: { id: string; name: string }[]; currency: string }) {
  const [tracking, setTracking] = useState<string>((item?.tracking as string) ?? "bulk");
  const v = (k: string) => (item?.[k] ?? "") as string;
  const isNew = !item?.id;
  return (
    <ActionForm action={saveItem} className="space-y-6">
      {item?.id && <input type="hidden" name="id" value={item.id} />}
      <section className="card grid gap-4 p-4 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className="label">Name *</span><input name="name" required defaultValue={v("name")} className="input" placeholder="Sony FX3 camera body" /></label>
        <label><span className="label">Item code</span><input name="code" defaultValue={v("code")} className="input" placeholder="CAM-FX3" /></label>
        <label><span className="label">Category</span>
          <select name="category_id" defaultValue={v("category_id")} className="input"><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="sm:col-span-2"><span className="label">Description</span><textarea name="description" rows={2} defaultValue={v("description")} className="input" /></label>
        <fieldset className="sm:col-span-2">
          <span className="label">Tracking</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {[["bulk", "Quantity-based", "Identical units counted by quantity (C-stands, cables, sandbags)."], ["serialized", "Individually tracked", "Each unit has its own asset code / serial number (cameras, lenses)."]].map(([val, title, desc]) => (
              <label key={val} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${tracking === val ? "border-brand bg-brand/5" : "border-line"} ${!isNew ? "opacity-70" : ""}`}>
                <input type="radio" name="tracking" value={val} checked={tracking === val} disabled={!isNew} onChange={() => setTracking(val)} className="mt-1 accent-[var(--brand)]" />
                <span><span className="block text-sm font-medium">{title}</span><span className="text-xs text-muted">{desc}</span></span>
              </label>
            ))}
          </div>
          {!isNew && <input type="hidden" name="tracking" value={tracking} />}
        </fieldset>
        {tracking === "bulk" ? (
          <div className="grid gap-4 sm:col-span-2 sm:grid-cols-4">
            <label><span className="label">Total quantity *</span><input name="quantity_total" type="number" min={1} step={1} required defaultValue={v("quantity_total") || "1"} className="input" /></label>
            <label><span className="label">In maintenance</span><input name="qty_maintenance" type="number" min={0} defaultValue={v("qty_maintenance") || "0"} className="input" /></label>
            <label><span className="label">Damaged</span><input name="qty_damaged" type="number" min={0} defaultValue={v("qty_damaged") || "0"} className="input" /></label>
            <label><span className="label">Missing</span><input name="qty_missing" type="number" min={0} defaultValue={v("qty_missing") || "0"} className="input" /></label>
          </div>
        ) : isNew ? (
          <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
            <label><span className="label">First asset code</span><input name="first_asset_code" className="input" placeholder="CAM-001" /></label>
            <label><span className="label">Serial number</span><input name="first_serial" className="input" /></label>
            <p className="text-xs text-muted sm:col-span-2">You can add more units on the item page after saving.</p>
          </div>
        ) : null}
      </section>

      <section className="card grid gap-4 p-4 sm:grid-cols-4">
        <h3 className="text-sm font-semibold sm:col-span-4">Rates & value ({currency})</h3>
        <label><span className="label">Rate per shift</span><input name="shift_rate" inputMode="decimal" defaultValue={v("shift_rate")} className="input" placeholder="Category default" /></label>
        <label><span className="label">Rate per full day</span><input name="day_rate" inputMode="decimal" defaultValue={v("day_rate")} className="input" placeholder="Category default" /></label>
        <label><span className="label">Purchase cost</span><input name="purchase_cost" inputMode="decimal" defaultValue={v("purchase_cost")} className="input" /></label>
        <label><span className="label">Replacement value</span><input name="replacement_value" inputMode="decimal" defaultValue={v("replacement_value")} className="input" /></label>
        <p className="text-xs text-muted sm:col-span-4">Leave a rate empty to use the category default. Changing a rate never changes existing rentals or invoices.</p>
      </section>

      <section className="card grid gap-4 p-4 sm:grid-cols-2">
        <label><span className="label">Condition</span>
          <select name="condition" defaultValue={v("condition") || "good"} className="input">{["new", "good", "fair", "worn", "damaged"].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label><span className="label">Owned / sourced from supplier</span>
          <select name="supplier_id" defaultValue={v("supplier_id")} className="input"><option value="">Own inventory</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="sm:col-span-2"><span className="label">Condition notes</span><textarea name="condition_notes" rows={2} defaultValue={v("condition_notes")} className="input" /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="is_kit" defaultChecked={!!item?.is_kit} className="accent-[var(--brand)]" />This is a kit (rented as one unit with accessories)</label>
        <label className="sm:col-span-2"><span className="label">Accessories / kit contents</span><textarea name="accessories" rows={2} defaultValue={v("accessories")} className="input" placeholder="2× batteries, charger, cage, top handle" /></label>
      </section>
      <div className="flex gap-2"><SubmitButton>{isNew ? "Save item" : "Save changes"}</SubmitButton></div>
    </ActionForm>
  );
}
