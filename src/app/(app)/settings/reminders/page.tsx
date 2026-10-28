import { requireTenant } from "@/lib/auth";
import { Card, Notice } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { saveReminderSettings } from "../actions";

export const metadata = { title: "Reminder settings" };
const KINDS: [string, string, string][] = [
  ["before_due", "Upcoming return", "minutes before the deadline"],
  ["at_due", "Return due", "at the deadline (offset ignored)"],
  ["overdue", "Overdue", "minutes after the deadline"],
  ["dispatch_confirmation", "Dispatch confirmation", "minutes after dispatch"],
  ["return_confirmation", "Return confirmation", "minutes after full return"],
];

export default async function ReminderSettings() {
  const ctx = await requireTenant();
  const s = ctx.settings;
  const owner = ctx.role === "owner";
  const { data: rules } = await ctx.supabase.from("reminder_rules").select("*").eq("tenant_id", ctx.tenantId);
  const rule = (k: string) => rules?.find((r) => r.kind === k);
  return (
    <ActionForm action={saveReminderSettings}>
      <fieldset disabled={!owner} className="space-y-6">
        {!owner && <Notice tone="info">Only the owner can change reminder rules. Managers can pause reminders from the Reminders page.</Notice>}
        <Card title="General">
          <div className="grid gap-4 sm:grid-cols-4">
            <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" name="reminders_enabled" defaultChecked={s.reminders_enabled} className="accent-[var(--brand)]" />Create reminder jobs for dispatched rentals</label>
            <label><span className="label">Quiet hours from</span><input type="time" name="quiet_hours_start" defaultValue={s.quiet_hours_start?.slice(0, 5) ?? ""} className="input" /></label>
            <label><span className="label">Quiet hours until</span><input type="time" name="quiet_hours_end" defaultValue={s.quiet_hours_end?.slice(0, 5) ?? ""} className="input" /></label>
            <label><span className="label">Max reminders per rental</span><input type="number" name="max_reminders_per_rental" min={0} max={50} defaultValue={s.max_reminders_per_rental} className="input" /></label>
            <p className="text-xs text-muted sm:col-span-4">Reminders that fall in quiet hours are delayed until quiet hours end ({s.timezone}). Placeholders for messages: {"{client} {company} {reference} {items} {due} {company_phone} {project}"}</p>
          </div>
        </Card>
        {KINDS.map(([k, title, hint]) => {
          const r = rule(k);
          return (
            <Card key={k} title={title}>
              <div className="grid gap-4 sm:grid-cols-[auto_160px_1fr]">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`${k}_enabled`} defaultChecked={r?.enabled} className="accent-[var(--brand)]" />Enabled</label>
                <label><span className="label">Offset</span><input type="number" min={0} name={`${k}_offset`} defaultValue={r?.offset_minutes ?? 0} className="input" /><span className="mt-1 block text-xs text-muted">{hint}</span></label>
                <label><span className="label">Message</span><textarea rows={2} name={`${k}_template`} defaultValue={r?.template ?? ""} className="input" /></label>
              </div>
            </Card>
          );
        })}
        {owner && <SubmitButton>Save reminder settings</SubmitButton>}
      </fieldset>
    </ActionForm>
  );
}
