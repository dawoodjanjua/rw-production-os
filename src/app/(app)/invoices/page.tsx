import Link from "next/link";
import { Plus } from "lucide-react";
import { requireTenant, roleAtLeast } from "@/lib/auth";
import { date, money } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, Stat, Table } from "@/components/ui";

export const metadata = { title: "Invoices" };
const TABS = [["", "All"], ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["draft", "Drafts"], ["paid", "Paid"]] as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const ctx = await requireTenant();
  const { tab = "", q = "" } = await searchParams;
  const cur = ctx.settings.currency;
  let query = ctx.supabase.from("v_invoices").select("*").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(200);
  if (tab === "unpaid") query = query.in("status", ["issued", "partially_paid"]);
  if (tab === "overdue") query = query.eq("is_overdue", true);
  if (tab === "draft") query = query.eq("status", "draft");
  if (tab === "paid") query = query.eq("status", "paid");
  const term = q.replace(/[%,()]/g, " ").trim();
  if (term) query = query.or(`number.ilike.%${term}%,client_name.ilike.%${term}%,project_name.ilike.%${term}%,rental_reference.ilike.%${term}%`);
  const [{ data: invoices }, { data: open }] = await Promise.all([
    query,
    ctx.supabase.from("v_invoices").select("balance,is_overdue").eq("tenant_id", ctx.tenantId).in("status", ["issued", "partially_paid"]),
  ]);
  const outstanding = (open ?? []).reduce((s, i) => s + Number(i.balance), 0);
  const overdue = (open ?? []).filter((i) => i.is_overdue).reduce((s, i) => s + Number(i.balance), 0);

  return (
    <>
      <PageHeader title="Invoices" subtitle="Branded invoices, payments and balances."
        actions={roleAtLeast(ctx.role, "manager") && <Link href="/invoices/new" className="btn-primary"><Plus size={16} />New invoice</Link>} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Outstanding" value={money(outstanding, cur)} hint={`${open?.length ?? 0} unpaid invoice(s)`} />
        <Stat label="Overdue" value={money(overdue, cur)} tone={overdue > 0 ? "danger" : "default"} hint={overdue > 0 ? "Past due date" : "Nothing overdue"} />
      </div>
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1">{TABS.map(([k, l]) => <Link key={k} href={`?tab=${k}`} className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? "bg-brand text-white" : "text-muted hover:bg-bg"}`}>{l}</Link>)}</div>
          <form className="flex gap-2"><input type="hidden" name="tab" value={tab} /><input name="q" defaultValue={q} placeholder="Number, client, project, rental" className="input sm:w-64" /><button className="btn-secondary">Search</button></form>
        </div>
        {invoices?.length ? (
          <Table head={<tr><th className="th">Invoice</th><th className="th">Client</th><th className="th">Issued</th><th className="th">Due</th><th className="th text-right">Total</th><th className="th text-right">Balance</th><th className="th">Status</th></tr>}>
            {invoices.map((i) => (
              <tr key={i.id} className="hover:bg-bg/50">
                <td className="td"><Link href={`/invoices/${i.id}`} className="font-medium hover:underline">{i.number}</Link>{i.rental_reference && <div className="text-xs text-muted">{i.rental_reference}</div>}</td>
                <td className="td">{i.client_name}<div className="text-xs text-muted">{i.project_name}</div></td>
                <td className="td text-muted">{date(i.issue_date)}</td>
                <td className={`td ${i.is_overdue ? "font-medium text-red-700" : "text-muted"}`}>{date(i.due_date)}</td>
                <td className="td text-right tabular-nums">{money(i.total, cur)}</td>
                <td className="td text-right tabular-nums">{money(i.balance, cur)}</td>
                <td className="td"><Badge status={i.display_status} /></td>
              </tr>
            ))}
          </Table>
        ) : <EmptyState title="No invoices" body="Create an invoice from a rental, or a manual invoice for other services." />}
      </Card>
    </>
  );
}
