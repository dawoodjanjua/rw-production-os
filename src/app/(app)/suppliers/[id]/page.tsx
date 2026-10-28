import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant, roleAtLeast } from "@/lib/auth";
import { Card, PageHeader, Table } from "@/components/ui";
import { ContactForm } from "../../contacts/contact-form";
import { archiveContact } from "../../contacts/actions";

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  const [{ data: s }, { data: items }] = await Promise.all([
    ctx.supabase.from("suppliers").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    ctx.supabase.from("equipment_items").select("id,name,code").eq("supplier_id", id).eq("tenant_id", ctx.tenantId).order("name"),
  ]);
  if (!s) notFound();
  const canEdit = roleAtLeast(ctx.role, "manager");
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title={s.name} actions={canEdit && <form action={archiveContact}><input type="hidden" name="kind" value="supplier" /><input type="hidden" name="id" value={id} /><input type="hidden" name="archive" value="1" /><button className="btn-ghost">Archive</button></form>} />
      {canEdit ? <ContactForm kind="supplier" contact={s} /> : <Card title="Contact"><p className="text-sm">{s.contact_person} {s.phone} {s.email}</p></Card>}
      <Card title="Equipment from this supplier" padded={false}>
        {items?.length ? <Table head={<tr><th className="th">Item</th><th className="th">Code</th></tr>}>
          {items.map((i) => <tr key={i.id}><td className="td"><Link className="link" href={`/equipment/${i.id}`}>{i.name}</Link></td><td className="td text-muted">{i.code ?? "—"}</td></tr>)}
        </Table> : <p className="p-4 text-sm text-muted">No equipment linked.</p>}
      </Card>
    </div>
  );
}
