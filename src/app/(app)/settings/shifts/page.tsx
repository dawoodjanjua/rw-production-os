import { requireTenant, roleAtLeast } from "@/lib/auth";
import { clock } from "@/lib/format";
import { Card } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { saveCategory, saveShift } from "../actions";

export const metadata = { title: "Shifts & rates" };

export default async function ShiftsPage() {
  const ctx = await requireTenant();
  const [{ data: shifts }, { data: cats }] = await Promise.all([
    ctx.supabase.from("shift_rules").select("*").eq("tenant_id", ctx.tenantId).order("sort_order"),
    ctx.supabase.from("equipment_categories").select("*").eq("tenant_id", ctx.tenantId).order("name"),
  ]);
  const owner = ctx.role === "owner", manager = roleAtLeast(ctx.role, "manager");
  const cur = ctx.settings.currency;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Shift schedule">
        <p className="mb-4 text-sm text-muted">A shift rental is due back at the end of its shift. If the end time is earlier than the start time, the shift ends the next day (overnight). The multiplier adjusts the item&apos;s shift rate for that shift (e.g. 1.5 for nights). Times use {ctx.settings.timezone}.</p>
        <div className="space-y-3">
          {shifts?.map((s) => (
            <ActionForm key={s.id} action={saveShift} className="rounded-lg border border-line p-3">
              <fieldset disabled={!owner} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_110px_110px_80px]">
                <input type="hidden" name="id" value={s.id} /><input type="hidden" name="sort_order" value={s.sort_order} />
                <label className="col-span-2 sm:col-span-1"><span className="label">Name</span><input name="name" defaultValue={s.name} className="input" /></label>
                <label><span className="label">Start</span><input type="time" name="start_time" defaultValue={s.start_time.slice(0, 5)} className="input" /></label>
                <label><span className="label">End</span><input type="time" name="end_time" defaultValue={s.end_time.slice(0, 5)} className="input" /></label>
                <label><span className="label">× Rate</span><input name="rate_multiplier" inputMode="decimal" defaultValue={s.rate_multiplier} className="input" /></label>
                <div className="col-span-2 flex items-center justify-between sm:col-span-4">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={s.active} className="accent-[var(--brand)]" />Active · {clock(s.start_time)}–{clock(s.end_time)}{s.end_time <= s.start_time ? " (overnight)" : ""}</label>
                  {owner && <SubmitButton className="btn-secondary py-1">Save</SubmitButton>}
                </div>
              </fieldset>
            </ActionForm>
          ))}
          {owner && (
            <ActionForm action={saveShift} resetOnSuccess className="rounded-lg border border-dashed border-line p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_110px_110px_80px]">
                <input type="hidden" name="sort_order" value={(shifts?.length ?? 0) + 1} />
                <label className="col-span-2 sm:col-span-1"><span className="label">New shift</span><input name="name" placeholder="Night shift" className="input" /></label>
                <label><span className="label">Start</span><input type="time" name="start_time" className="input" /></label>
                <label><span className="label">End</span><input type="time" name="end_time" className="input" /></label>
                <label><span className="label">× Rate</span><input name="rate_multiplier" defaultValue="1" className="input" /></label>
              </div>
              <SubmitButton className="btn-secondary mt-2">Add shift</SubmitButton>
            </ActionForm>
          )}
        </div>
      </Card>

      <Card title={`Category default rates (${cur})`}>
        <p className="mb-4 text-sm text-muted">Used when an item has no rate of its own. Item rates override these. Changes never affect existing rentals or invoices.</p>
        <div className="space-y-2">
          {cats?.map((c) => (
            <ActionForm key={c.id} action={saveCategory}>
              <fieldset disabled={!manager} className="grid grid-cols-[1fr_100px_100px_auto] items-end gap-2">
                <input type="hidden" name="id" value={c.id} />
                <label><span className="label">Category</span><input name="name" defaultValue={c.name} className="input" /></label>
                <label><span className="label">Per shift</span><input name="default_shift_rate" inputMode="decimal" defaultValue={c.default_shift_rate ?? ""} className="input" /></label>
                <label><span className="label">Per day</span><input name="default_day_rate" inputMode="decimal" defaultValue={c.default_day_rate ?? ""} className="input" /></label>
                {manager && <SubmitButton className="btn-secondary">Save</SubmitButton>}
              </fieldset>
            </ActionForm>
          ))}
          {manager && (
            <ActionForm action={saveCategory} resetOnSuccess className="grid grid-cols-[1fr_100px_100px_auto] items-end gap-2 border-t border-line pt-3">
              <label><span className="label">New category</span><input name="name" className="input" /></label>
              <label><span className="label">Per shift</span><input name="default_shift_rate" inputMode="decimal" className="input" /></label>
              <label><span className="label">Per day</span><input name="default_day_rate" inputMode="decimal" className="input" /></label>
              <SubmitButton className="btn-secondary">Add</SubmitButton>
            </ActionForm>
          )}
        </div>
      </Card>
    </div>
  );
}
