import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant, roleAtLeast } from "@/lib/auth";
import { clock, dateTime, money, STATUS_LABEL, toLocalInput } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { rentalMessage } from "@/lib/whatsapp";
import { Badge, Card, DL, Notice, PageHeader, Table } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { addCharge, cancelRental, closeRental, dispatchReserved, extendRental, invoiceFromRental, removeCharge } from "../actions";

const EVENT_LABEL: Record<string, string> = {
  reserved: "Created", dispatched: "Dispatched", returned: "Fully returned", partial_return: "Partial return", extended: "Extended",
  deadline_changed: "Deadline changed", charge_added: "Charge added", charge_removed: "Charge removed", cancelled: "Cancelled", closed: "Closed", note: "Note",
};

export default async function RentalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; returned?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant();
  const tz = ctx.settings.timezone;
  const [{ data: r }, { data: lines }, { data: charges }, { data: events }, { data: reminders }, { data: messages }, { data: invoices }] = await Promise.all([
    ctx.supabase.from("v_rentals").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    ctx.supabase.from("rental_items").select("*").eq("rental_id", id).eq("tenant_id", ctx.tenantId).order("description").order("asset_code"),
    ctx.supabase.from("rental_charges").select("*").eq("rental_id", id).eq("tenant_id", ctx.tenantId).order("created_at"),
    ctx.supabase.from("rental_events").select("*").eq("rental_id", id).eq("tenant_id", ctx.tenantId).order("occurred_at"),
    ctx.supabase.from("scheduled_reminders").select("*").eq("rental_id", id).eq("tenant_id", ctx.tenantId).order("due_at"),
    ctx.supabase.from("message_logs").select("*").eq("rental_id", id).eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(20),
    ctx.supabase.from("invoices").select("id,number,status").eq("rental_id", id).eq("tenant_id", ctx.tenantId).neq("status", "void"),
  ]);
  if (!r) notFound();
  const actorIds = [...new Set((events ?? []).map((e) => e.created_by).filter(Boolean))];
  const { data: actors } = actorIds.length ? await ctx.supabase.from("user_profiles").select("id,full_name,email").in("id", actorIds) : { data: [] };
  const actor = new Map((actors ?? []).map((a) => [a.id, a.full_name || a.email]));
  const cur = r.currency;
  const isManager = roleAtLeast(ctx.role, "manager");
  const out = ["dispatched", "partially_returned"].includes(r.status);
  const open = ["reserved", "dispatched", "partially_returned"].includes(r.status);
  const shift = r.terms?.shift as { name: string; start_time: string; end_time: string } | null;
  const phone = r.responsible_whatsapp ?? r.client_whatsapp;
  const invoice = invoices?.[0];
  const msg = rentalMessage({
    client: r.responsible_name || r.client_name, company: ctx.settings.company_name, reference: r.reference,
    items: (lines ?? []).map((l) => `${l.description}${l.asset_code ? ` (${l.asset_code})` : ""}${l.quantity > 1 ? ` ×${l.quantity}` : ""}`).join(", "),
    due: dateTime(r.expected_return_at, tz), total: money(r.total, cur), phone: displayPhone(ctx.settings.phone) || null,
  });

  return (
    <>
      <PageHeader title={r.reference}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Badge status={r.display_status} /><Link href={`/clients/${r.client_id}`} className="link">{r.client_name}</Link>{r.project_name && <span>· {r.project_name}</span>}</span>}
        actions={<>
          {out && <Link href={`/rentals/${id}/return`} className="btn-primary">Record return</Link>}
          <WhatsAppButton phone={phone} message={msg} purpose="rental" rentalId={id} clientId={r.client_id} />
          {invoice ? <Link href={`/invoices/${invoice.id}`} className="btn-secondary">Invoice {invoice.number}</Link>
            : isManager && r.status !== "cancelled" && <ActionForm action={invoiceFromRental}><input type="hidden" name="rental_id" value={id} /><SubmitButton className="btn-secondary" pendingText="Creating…">Create invoice</SubmitButton></ActionForm>}
        </>} />

      <div className="space-y-3">
        {sp.created && <Notice tone="ok">{r.status === "reserved" ? "Reservation saved. Stock is held until dispatch." : "Dispatch recorded. Return reminders are scheduled (see below)."}</Notice>}
        {sp.returned && <Notice tone="ok">Return recorded. {r.status === "returned" ? "All equipment is accounted for and pending reminders were cancelled." : `${r.qty_outstanding} unit(s) still out.`}</Notice>}
        {r.is_overdue && <Notice tone="danger">This rental was due {dateTime(r.expected_return_at, tz)} and {r.qty_outstanding} unit(s) are still out.</Notice>}
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Equipment" padded={false}>
            <Table head={<tr><th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Returned</th><th className="th text-right">Rate</th><th className="th text-right">Line total</th></tr>}>
              {lines?.map((l) => (
                <tr key={l.id}>
                  <td className="td"><div className="font-medium">{l.description}</div><div className="text-xs text-muted">{[l.asset_code, l.condition_out && `Out: ${l.condition_out}`, l.condition_in && `In: ${l.condition_in}`].filter(Boolean).join(" · ")}</div></td>
                  <td className="td text-right tabular-nums">{l.quantity}</td>
                  <td className="td text-right tabular-nums">{l.qty_returned}/{l.quantity}
                    {l.qty_damaged > 0 && <div className="text-xs text-amber-700">{l.qty_damaged} damaged</div>}
                    {l.qty_missing > 0 && <div className="text-xs text-red-700">{l.qty_missing} missing</div>}</td>
                  <td className="td text-right tabular-nums">{money(l.unit_rate, cur)} × {r.units}<div className="text-xs text-muted">{l.rate_source}</div></td>
                  <td className="td text-right tabular-nums">{money(l.line_total, cur)}</td>
                </tr>
              ))}
            </Table>
            <div className="border-t border-line p-4">
              <dl className="ml-auto max-w-xs space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Equipment subtotal</dt><dd className="tabular-nums">{money(r.subtotal, cur)}</dd></div>
                {charges?.map((c) => (
                  <div key={c.id} className="flex justify-between gap-3"><dt className="text-muted">{c.description}</dt><dd className="tabular-nums">{money(c.amount, cur)}</dd></div>
                ))}
                {Number(r.discount_amount) > 0 && <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd className="tabular-nums">−{money(r.discount_amount, cur)}</dd></div>}
                <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(r.total, cur)}</dd></div>
                {Number(r.deposit_amount) > 0 && <div className="flex justify-between text-muted"><dt>Deposit received</dt><dd className="tabular-nums">{money(r.deposit_amount, cur)}</dd></div>}
              </dl>
            </div>
          </Card>

          {isManager && (open || r.status === "returned") && (
            <Card title="Charges & changes">
              <div className="grid gap-6 md:grid-cols-2">
                {open && (
                  <ActionForm action={extendRental} className="space-y-2">
                    <h3 className="text-sm font-medium">{r.rental_type === "custom" ? "Change deadline" : "Extend rental"}</h3>
                    <input type="hidden" name="rental_id" value={id} />
                    {r.rental_type === "custom"
                      ? <input type="datetime-local" name="new_deadline_local" required defaultValue={toLocalInput(r.expected_return_at, tz)} className="input" />
                      : <input type="number" name="additional_units" min={1} defaultValue={1} className="input" aria-label="Additional units" />}
                    <input name="reason" placeholder="Reason (optional)" className="input" />
                    <p className="text-xs text-muted">{r.rental_type === "custom" ? "Recalculates days at the original rate." : `Adds ${r.billing_basis === "shift" ? "shifts" : "days"} at the original rate.`} Reminders are rescheduled.</p>
                    <SubmitButton className="btn-secondary">{r.rental_type === "custom" ? "Update deadline" : "Extend"}</SubmitButton>
                  </ActionForm>
                )}
                <ActionForm action={addCharge} resetOnSuccess className="space-y-2">
                  <h3 className="text-sm font-medium">Add charge</h3>
                  <input type="hidden" name="rental_id" value={id} />
                  <select name="kind" className="input">{["damage", "missing", "transport", "crew", "extension", "late_fee", "other"].map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</select>
                  <input name="description" placeholder="Description" required className="input" />
                  <input name="amount" inputMode="decimal" placeholder={`Amount (${cur})`} required className="input" />
                  <SubmitButton className="btn-secondary">Add charge</SubmitButton>
                </ActionForm>
              </div>
              {charges && charges.length > 0 && (
                <div className="mt-6 border-t border-line pt-4">
                  <h3 className="mb-2 text-sm font-medium">Additional charges</h3>
                  <ul className="space-y-2 text-sm">
                    {charges.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>{c.description} · <b>{money(c.amount, cur)}</b>{c.calculation && <span className="ml-1 text-xs text-muted">({Math.round(c.calculation.late_minutes)} min late, {c.calculation.grace_minutes} min grace)</span>}</span>
                        <ActionForm action={removeCharge} confirm="Remove this charge?"><input type="hidden" name="rental_id" value={id} /><input type="hidden" name="charge_id" value={c.id} /><SubmitButton className="btn-ghost py-1 text-xs">Remove / waive</SubmitButton></ActionForm>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          <Card title="Activity">
            <ol className="space-y-3">
              {events?.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />
                  <div>
                    <div><b>{EVENT_LABEL[e.event_type] ?? e.event_type}</b> · <span className="text-muted">{dateTime(e.occurred_at, tz)}</span>
                      {actor.get(e.created_by) && <span className="text-muted"> · {actor.get(e.created_by)}</span>}</div>
                    {e.event_type === "extended" || e.event_type === "deadline_changed" ? <div className="text-xs text-muted">Deadline {dateTime(e.data.from_deadline, tz)} → {dateTime(e.data.to_deadline, tz)}{e.data.reason ? ` · ${e.data.reason}` : ""}</div> : null}
                    {e.data?.lines && <div className="text-xs text-muted">{e.data.lines.map((l: { description: string; asset_code?: string; returned: number; damaged: number; missing: number }) => `${l.description}${l.asset_code ? ` (${l.asset_code})` : ""}: ${l.returned} returned${l.damaged ? `, ${l.damaged} damaged` : ""}${l.missing ? `, ${l.missing} missing` : ""}`).join("; ")}{e.data.late_fee > 0 ? ` · late fee ${money(e.data.late_fee, cur)}` : ""}</div>}
                    {e.event_type === "charge_added" && <div className="text-xs text-muted">{e.data.description}: {money(e.data.amount, cur)}</div>}
                    {e.event_type === "charge_removed" && <div className="text-xs text-muted">{e.data.description}: {money(e.data.amount, cur)}{e.data.reason ? ` · ${e.data.reason}` : ""}</div>}
                    {e.event_type === "cancelled" && e.data?.reason && <div className="text-xs text-muted">{e.data.reason}</div>}
                    {e.event_type === "dispatched" && e.data?.condition && <div className="text-xs text-muted">Condition: {e.data.condition}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Schedule">
            <DL items={[
              ["Rental type", r.rental_type === "shift" ? `Shift · ${r.units} shift(s)` : r.rental_type === "full_day" ? `Full day · ${r.units} day(s)` : `Custom · billed ${r.units} day(s)`],
              ...(shift ? [["Shift", `${shift.name} · ${clock(shift.start_time)}–${clock(shift.end_time)}`] as [string, string]] : []),
              [r.status === "reserved" ? "Planned dispatch" : "Dispatched", dateTime(r.dispatched_at ?? r.start_at, tz)],
              ["Return deadline", <span key="d" className={r.is_overdue ? "font-medium text-red-700" : "font-medium"}>{dateTime(r.expected_return_at, tz)}</span>],
              ["Returned", r.returned_at ? dateTime(r.returned_at, tz) : "—"],
              ["Grace / late fee", `${r.terms?.grace_minutes ?? 0} min · ${r.terms?.late_fee_mode === "none" || !r.terms?.late_fee_mode ? "no late fee" : r.terms.late_fee_mode === "per_unit_per_hour" ? `${money(r.terms.late_fee_amount, cur)}/unit/hour` : "day rate per late day"}`],
            ]} />
          </Card>
          <Card title="Contacts & location">
            <DL items={[["Responsible", r.responsible_name ?? "—"], ["WhatsApp", displayPhone(phone) || "—"], ["Location", r.location ?? "—"], ["Dispatch condition", r.dispatch_condition ?? "—"]]} />
            {r.notes && <p className="mt-3 whitespace-pre-line text-sm text-muted">{r.notes}</p>}
          </Card>

          {r.status === "reserved" && (
            <Card title="Dispatch reservation">
              <ActionForm action={dispatchReserved} className="space-y-2">
                <input type="hidden" name="rental_id" value={id} />
                <label className="block"><span className="label">Dispatch time</span><input type="datetime-local" name="dispatch_local" defaultValue={toLocalInput(new Date(), tz)} className="input" /></label>
                <input name="condition" placeholder="Condition at dispatch" className="input" />
                <SubmitButton>Dispatch now</SubmitButton>
              </ActionForm>
              {isManager && <ActionForm action={cancelRental} confirm="Cancel this reservation and release the stock?" className="mt-4 space-y-2 border-t border-line pt-4">
                <input type="hidden" name="rental_id" value={id} /><input name="reason" placeholder="Cancellation reason" className="input" />
                <SubmitButton className="btn-danger">Cancel reservation</SubmitButton>
              </ActionForm>}
            </Card>
          )}
          {r.status === "returned" && isManager && (
            <Card title="Close rental"><p className="mb-3 text-sm text-muted">Close when everything is settled. Closed rentals cannot be changed.</p>
              <ActionForm action={closeRental}><input type="hidden" name="rental_id" value={id} /><SubmitButton className="btn-secondary">Close rental</SubmitButton></ActionForm></Card>
          )}

          <Card title="Reminders" actions={<Link href="/reminders" className="text-xs link">All reminders</Link>}>
            {reminders?.length ? (
              <ul className="space-y-2 text-sm">
                {reminders.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span><span className="capitalize">{m.kind.replace(/_/g, " ")}</span><span className="block text-xs text-muted">{dateTime(m.due_at, tz)}{m.cancel_reason ? ` · ${m.cancel_reason}` : ""}{m.last_error ? ` · ${m.last_error}` : ""}</span></span>
                    <Badge status={m.status} />
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">{r.status === "reserved" ? "Reminders are scheduled when the equipment is dispatched." : "No reminders."}</p>}
          </Card>
          <Card title="Messages">
            {messages?.length ? (
              <ul className="space-y-2 text-sm">{messages.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2"><span className="text-xs text-muted">{dateTime(m.created_at, tz)} · {m.purpose.replace(/_/g, " ")}</span><Badge status={m.status}>{STATUS_LABEL[m.status]}</Badge></li>
              ))}</ul>
            ) : <p className="text-sm text-muted">No messages yet.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
