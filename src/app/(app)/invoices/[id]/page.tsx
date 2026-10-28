import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireTenant, roleAtLeast } from "@/lib/auth";
import { logoUrl } from "@/lib/branding";
import { date, dateTime, money, toLocalInput } from "@/lib/format";
import { loadInvoice } from "@/lib/invoice-data";
import { displayPhone } from "@/lib/phone";
import { invoiceMessage } from "@/lib/whatsapp";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { deleteDraft, deletePayment, issueInvoice, recordPayment, voidInvoice } from "../actions";

const METHODS = [["cash", "Cash"], ["bank_transfer", "Bank transfer"], ["mobile_wallet", "JazzCash / Easypaisa"], ["cheque", "Cheque"], ["card", "Card"], ["other", "Other"]];

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  const data = await loadInvoice(ctx, id);
  if (!data) notFound();
  const { inv, items, payments, client, company, brand } = data;
  const cur = inv.currency, tz = ctx.settings.timezone;
  const logo = await logoUrl(ctx.supabase, company.logo_path);
  const isManager = roleAtLeast(ctx.role, "manager");
  const isOwner = ctx.role === "owner";
  const balance = Number(inv.balance);
  const msg = invoiceMessage({
    client: client.contact_person || client.name, company: company.company_name, number: inv.number, total: money(inv.total, cur),
    balance: money(balance, cur), due: date(inv.due_date), project: inv.project_name, instructions: inv.payment_instructions, phone: displayPhone(company.phone) || null,
  });

  return (
    <>
      <PageHeader title={`Invoice ${inv.number}`} subtitle={<span className="flex items-center gap-2"><Badge status={inv.display_status} />{inv.rental_reference && <Link className="link" href={`/rentals/${inv.rental_id}`}>Rental {inv.rental_reference}</Link>}</span>}
        actions={<>
          <a href={`/api/invoices/${id}/pdf`} className="btn-primary"><Download size={16} />Download PDF</a>
          {inv.status !== "void" && <WhatsAppButton phone={client.whatsapp ?? null} message={msg} purpose="invoice" invoiceId={id} clientId={inv.client_id} />}
          {inv.status === "draft" && isManager && <Link href={`/invoices/${id}/edit`} className="btn-secondary">Edit</Link>}
        </>} />

      {inv.status === "draft" && <div className="mb-4"><Notice tone="info">This is a draft. Issue it to lock the details and start recording payments.</Notice></div>}
      {inv.status === "void" && <div className="mb-4"><Notice tone="warn">Void{inv.void_reason ? `: ${inv.void_reason}` : ""}.</Notice></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Invoice document preview — mirrors the PDF layout */}
        <article className="card overflow-hidden">
          <div className="h-1.5" style={{ background: brand }} />
          <div className="p-6 sm:p-10">
            <header className="flex flex-col justify-between gap-6 sm:flex-row">
              <div className="flex items-start gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {logo && <img src={logo} alt="" className="h-14 w-14 object-contain" />}
                <div>
                  <div className="text-lg font-bold uppercase tracking-wide" style={{ color: brand }}>{company.company_name}</div>
                  {company.tagline && <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{company.tagline}</div>}
                  <div className="mt-2 space-y-0.5 text-xs text-muted">
                    {company.address && <div className="whitespace-pre-line">{company.address}</div>}
                    <div>{[displayPhone(company.phone), company.email, company.website].filter(Boolean).join(" · ")}</div>
                    {company.ntn && <div>NTN: {company.ntn}</div>}
                  </div>
                </div>
              </div>
              <div className="sm:text-right">
                <div className="text-2xl font-light tracking-[0.2em] text-muted">INVOICE</div>
                <div className="mt-1 font-semibold">{inv.number}</div>
                <div className="mt-2 text-xs text-muted">Issued {date(inv.issue_date)}<br />Due {date(inv.due_date)}</div>
              </div>
            </header>
            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Bill to</div>
                <div className="mt-1 font-semibold">{client.name}</div>
                <div className="text-sm text-muted">{[client.contact_person, displayPhone(client.whatsapp ?? client.phone), client.email].filter(Boolean).join(" · ")}</div>
                {client.address && <div className="whitespace-pre-line text-sm text-muted">{client.address}</div>}
              </div>
              {(inv.project_name || inv.rental_reference) && (
                <div className="sm:text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Project</div>
                  <div className="mt-1 text-sm">{inv.project_name}</div>
                  {inv.rental_reference && <div className="text-sm text-muted">Rental {inv.rental_reference}</div>}
                </div>
              )}
            </div>
            <div className="mt-8 overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead><tr className="border-b-2" style={{ borderColor: brand }}>
                  <th className="py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">Description</th>
                  <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted">Qty</th>
                  <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted">Rate</th>
                  <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted">Amount</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {items.map((i) => (
                    <tr key={i.id}><td className="py-2.5 pr-3">{i.description}</td><td className="py-2.5 text-right tabular-nums">{Number(i.quantity)}</td>
                      <td className="py-2.5 text-right tabular-nums">{money(i.unit_price, cur)}</td><td className="py-2.5 text-right tabular-nums">{money(i.amount, cur)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-6 flex justify-end">
              <dl className="w-full max-w-xs space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{money(inv.subtotal, cur)}</dd></div>
                {Number(inv.discount_amount) > 0 && <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd className="tabular-nums">−{money(inv.discount_amount, cur)}</dd></div>}
                {Number(inv.tax_rate) > 0 && <div className="flex justify-between"><dt className="text-muted">Tax ({Number(inv.tax_rate)}%)</dt><dd className="tabular-nums">{money(inv.tax_amount, cur)}</dd></div>}
                <div className="flex justify-between border-t-2 pt-2 text-base font-bold" style={{ borderColor: brand }}><dt>Total</dt><dd className="tabular-nums">{money(inv.total, cur)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Paid</dt><dd className="tabular-nums">{money(inv.amount_paid, cur)}</dd></div>
                <div className="flex justify-between font-semibold"><dt>Balance due</dt><dd className="tabular-nums">{money(balance, cur)}</dd></div>
              </dl>
            </div>
            {(inv.payment_instructions || inv.notes) && (
              <div className="mt-8 grid gap-6 border-t border-line pt-6 text-sm sm:grid-cols-2">
                {inv.payment_instructions && <div><div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Payment instructions</div><p className="mt-1 whitespace-pre-line">{inv.payment_instructions}</p></div>}
                {inv.notes && <div><div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Notes</div><p className="mt-1 whitespace-pre-line">{inv.notes}</p></div>}
              </div>
            )}
            {company.invoice_footer && <p className="mt-8 text-center text-xs text-muted">{company.invoice_footer}</p>}
          </div>
        </article>

        <aside className="space-y-6">
          <Card title="Status">
            <div className="flex items-baseline justify-between"><span className="text-sm text-muted">Balance due</span><span className="text-xl font-semibold tabular-nums">{money(balance, cur)}</span></div>
            <div className="mt-1 text-xs text-muted">of {money(inv.total, cur)} · due {date(inv.due_date)}</div>
            {isManager && inv.status === "draft" && (
              <div className="mt-4 space-y-2">
                <ActionForm action={issueInvoice}><input type="hidden" name="invoice_id" value={id} /><SubmitButton className="btn-primary w-full">Issue invoice</SubmitButton></ActionForm>
                <ActionForm action={deleteDraft} confirm="Delete this draft invoice?"><input type="hidden" name="invoice_id" value={id} /><SubmitButton className="btn-ghost w-full text-red-700">Delete draft</SubmitButton></ActionForm>
              </div>
            )}
          </Card>

          {isManager && ["issued", "partially_paid"].includes(inv.status) && (
            <Card title="Record payment">
              <ActionForm action={recordPayment} resetOnSuccess className="space-y-2">
                <input type="hidden" name="invoice_id" value={id} />
                <label className="block"><span className="label">Amount ({cur})</span><input name="amount" inputMode="decimal" required defaultValue={balance} className="input" /></label>
                <label className="block"><span className="label">Received</span><input type="datetime-local" name="paid_local" defaultValue={toLocalInput(new Date(), tz)} className="input" /></label>
                <label className="block"><span className="label">Method</span><select name="method" className="input">{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                <input name="reference" placeholder="Reference / transaction ID" className="input" />
                <SubmitButton className="btn-primary w-full">Record payment</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card title={`Payments (${payments.length})`}>
            {payments.length ? (
              <ul className="space-y-3 text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-2">
                    <div><div className="font-medium tabular-nums">{money(p.amount, cur)}</div>
                      <div className="text-xs text-muted">{dateTime(p.paid_at, tz)} · {METHODS.find((m) => m[0] === p.method)?.[1] ?? (p.method === "deposit" ? "Deposit" : p.method)}{p.reference ? ` · ${p.reference}` : ""}</div></div>
                    {isOwner && inv.status !== "void" && <ActionForm action={deletePayment} confirm="Remove this payment?"><input type="hidden" name="invoice_id" value={id} /><input type="hidden" name="payment_id" value={p.id} /><SubmitButton className="btn-ghost px-2 py-1 text-xs">Remove</SubmitButton></ActionForm>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No payments recorded.</p>}
          </Card>

          {isOwner && inv.status !== "void" && inv.status !== "draft" && (
            <Card title="Void invoice">
              <ActionForm action={voidInvoice} confirm="Void this invoice? This cannot be undone." className="space-y-2">
                <input type="hidden" name="invoice_id" value={id} /><input name="reason" placeholder="Reason" className="input" />
                <SubmitButton className="btn-danger w-full">Void</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
