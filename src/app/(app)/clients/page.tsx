import Link from "next/link";
import { Plus } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { money } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { Card, EmptyState, PageHeader, SearchBox, Table } from "@/components/ui";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireTenant();
  const { q = "" } = await searchParams;
  let query = ctx.supabase.from("clients").select("*").eq("tenant_id", ctx.tenantId).is("archived_at", null).order("name").limit(200);
  const term = q.replace(/[%,()]/g, " ").trim();
  if (term) query = query.or(`name.ilike.%${term}%,contact_person.ilike.%${term}%,phone.ilike.%${term}%,whatsapp.ilike.%${term}%`);
  const [{ data: clients }, { data: balances }] = await Promise.all([
    query,
    ctx.supabase.from("v_invoices").select("client_id, balance").eq("tenant_id", ctx.tenantId).in("status", ["issued", "partially_paid"]),
  ]);
  const owed = new Map<string, number>();
  balances?.forEach((b) => owed.set(b.client_id, (owed.get(b.client_id) ?? 0) + Number(b.balance)));

  return (
    <>
      <PageHeader title="Clients" subtitle="Production companies and individuals you rent to."
        actions={<Link href="/clients/new" className="btn-primary"><Plus size={16} />Add client</Link>} />
      <Card padded={false}>
        <div className="border-b border-line p-4"><SearchBox placeholder="Search name, contact or phone…" defaultValue={q} /></div>
        {clients && clients.length > 0 ? (
          <Table head={<tr><th className="th">Client</th><th className="th">Contact</th><th className="th">WhatsApp</th><th className="th text-right">Outstanding</th></tr>}>
            {clients.map((c) => (
              <tr key={c.id} className="hover:bg-bg/50">
                <td className="td"><Link href={`/clients/${c.id}`} className="font-medium hover:underline">{c.name}</Link>{c.email && <div className="text-xs text-muted">{c.email}</div>}</td>
                <td className="td text-muted">{c.contact_person ?? "—"}</td>
                <td className="td text-muted">{displayPhone(c.whatsapp) || "—"}</td>
                <td className={`td text-right tabular-nums ${owed.get(c.id) ? "font-medium" : "text-muted"}`}>{money(owed.get(c.id) ?? 0, ctx.settings.currency)}</td>
              </tr>
            ))}
          </Table>
        ) : <EmptyState title={term ? "No matching clients" : "No clients yet"} body={!term && "Add the production houses and people you rent equipment to."}
              action={!term && <Link href="/clients/new" className="btn-primary">Add client</Link>} />}
      </Card>
    </>
  );
}
