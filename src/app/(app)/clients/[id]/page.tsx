import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant, roleAtLeast } from "@/lib/auth";
import { date, dateTime, money } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { Badge, Card, DL, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { ContactForm } from "../../contacts/contact-form";
import { archiveContact } from "../../contacts/actions";

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { id } = await params;
  const { edit } = await searchParams;
  const ctx = await requireTenant();
  const tz = ctx.settings.timezone, cur = ctx.settings.currency;
  const [{ data: c }, { data: rentals }, { data: invoices }] = await Promise.all([
    ctx.supabase.from("clients").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    ctx.supabase.from("v_rentals").select("id,reference,project_name,display_status,start_at,expected_return_at,total").eq("client_id", id).eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(50),
    ctx.supabase.from("v_invoices").select("id,number,display_status,status,issue_date,due_date,total,balance").eq("client_id", id).eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(50),
  ]);
  if (!c) notFound();
  const canManage = roleAtLeast(ctx.role, "manager");
  const outstanding = (invoices ?? []).filter((i) => ["issued", "partially_paid"].includes(i.status)).reduce((s, i) => s + Number(i.balance), 0);
  const billed = (invoices ?? []).filter((i) => i.status !== "void" && i.status !== "draft").reduce((s, i) => s + Number(i.total), 0);

  if (edit && canManage) return <div className="max-w-2xl"><PageHeader title={`Edit ${c.name}`} /><ContactForm kind="client" contact={c} /></div>;

  return (
    <>
      <PageHeader title={c.name} subtitle={c.contact_person}
        actions={<>
          <Link href={`/rentals/new?client=${id}`} className="btn-primary">New dispatch</Link>
          {canManage && <Link href={`?edit=1`} className="btn-secondary">Edit</Link>}
          {canManage && <form action={archiveContact}><input type="hidden" name="kind" value="client" /><input type="hidden" name="id" value={id} /><input type="hidden" name="archive" value="1" /><button className="btn-ghost">Archive</button></form>}
        </>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Outstanding" value={money(outstanding, cur)} tone={outstanding > 0 ? "warn" : "default"} />
        <Stat label="Total billed" value={money(billed, cur)} />
        <Stat label="Rentals" value={rentals?.length ?? 0} />
        <Stat label="Open rentals" value={(rentals ?? []).filter((r) => ["dispatched", "partially_returned", "overdue", "reserved"].includes(r.display_status)).length} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Contact">
          <DL items={[["Phone", displayPhone(c.phone) || "—"], ["WhatsApp", displayPhone(c.whatsapp) || "—"], ["Email", c.email ?? "—"], ["Address", c.address ?? "—"]]} />
          {c.notes && <p className="mt-4 whitespace-pre-line text-sm text-muted">{c.notes}</p>}
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card title="Rentals" padded={false}>
            {rentals?.length ? (
              <Table head={<tr><th className="th">Rental</th><th className="th">Project</th><th className="th">Dates</th><th className="th text-right">Total</th><th className="th">Status</th></tr>}>
                {rentals.map((r) => (
                  <tr key={r.id}><td className="td"><Link className="link font-medium" href={`/rentals/${r.id}`}>{r.reference}</Link></td>
                    <td className="td">{r.project_name ?? "—"}</td><td className="td text-muted">{dateTime(r.start_at, tz)} → {dateTime(r.expected_return_at, tz)}</td>
                    <td className="td text-right tabular-nums">{money(r.total, cur)}</td><td className="td"><Badge status={r.display_status} /></td></tr>
                ))}
              </Table>
            ) : <EmptyState title="No rentals yet" />}
          </Card>
          <Card title="Invoices" padded={false}>
            {invoices?.length ? (
              <Table head={<tr><th className="th">Invoice</th><th className="th">Issued</th><th className="th">Due</th><th className="th text-right">Total</th><th className="th text-right">Balance</th><th className="th">Status</th></tr>}>
                {invoices.map((i) => (
                  <tr key={i.id}><td className="td"><Link className="link font-medium" href={`/invoices/${i.id}`}>{i.number}</Link></td>
                    <td className="td text-muted">{date(i.issue_date)}</td><td className="td text-muted">{date(i.due_date)}</td>
                    <td className="td text-right tabular-nums">{money(i.total, cur)}</td><td className="td text-right tabular-nums">{money(i.balance, cur)}</td>
                    <td className="td"><Badge status={i.display_status} /></td></tr>
                ))}
              </Table>
            ) : <EmptyState title="No invoices yet" />}
          </Card>
        </div>
      </div>
    </>
  );
}
