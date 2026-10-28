import Link from "next/link";
import { Plus } from "lucide-react";
import { requireTenant, roleAtLeast } from "@/lib/auth";
import { displayPhone } from "@/lib/phone";
import { Card, EmptyState, PageHeader, SearchBox, Table } from "@/components/ui";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireTenant();
  const { q = "" } = await searchParams;
  let query = ctx.supabase.from("suppliers").select("*").eq("tenant_id", ctx.tenantId).is("archived_at", null).order("name");
  const term = q.replace(/[%,()]/g, " ").trim();
  if (term) query = query.or(`name.ilike.%${term}%,contact_person.ilike.%${term}%`);
  const { data } = await query;
  const canEdit = roleAtLeast(ctx.role, "manager");
  return (
    <>
      <PageHeader title="Suppliers" subtitle="Vendors you buy or sub-rent equipment from. Suppliers are contacts only — they have no login."
        actions={canEdit && <Link href="/suppliers/new" className="btn-primary"><Plus size={16} />Add supplier</Link>} />
      <Card padded={false}>
        <div className="border-b border-line p-4"><SearchBox placeholder="Search suppliers…" defaultValue={q} /></div>
        {data?.length ? (
          <Table head={<tr><th className="th">Supplier</th><th className="th">Contact</th><th className="th">Phone</th><th className="th">Email</th></tr>}>
            {data.map((s) => (
              <tr key={s.id} className="hover:bg-bg/50"><td className="td"><Link href={`/suppliers/${s.id}`} className="font-medium hover:underline">{s.name}</Link></td>
                <td className="td text-muted">{s.contact_person ?? "—"}</td><td className="td text-muted">{displayPhone(s.phone) || "—"}</td><td className="td text-muted">{s.email ?? "—"}</td></tr>
            ))}
          </Table>
        ) : <EmptyState title="No suppliers yet" />}
      </Card>
    </>
  );
}
