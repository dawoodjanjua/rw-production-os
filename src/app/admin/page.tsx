import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/auth";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { createTenant } from "./actions";
import { AdminForm } from "./admin-form";

const PLAN: Record<string, string> = { starter: "Starter · PKR 5,000/mo", professional: "Professional · PKR 10,000/mo", white_label: "White-label · PKR 20,000+/mo" };

export default async function AdminHome() {
  await requirePlatformAdmin();
  const db = createAdminClient();
  const [{ data: tenants }, { data: members }, { data: rentals }] = await Promise.all([
    db.from("tenants").select("*").order("created_at", { ascending: false }),
    db.from("tenant_memberships").select("tenant_id").eq("active", true),
    db.from("rentals").select("tenant_id"),
  ]);
  const count = (rows: { tenant_id: string }[] | null, id: string) => (rows ?? []).filter((r) => r.tenant_id === id).length;
  return (
    <>
      <PageHeader title="Tenants" subtitle="Each tenant is an isolated company workspace. Platform admins manage workspaces but do not see tenant business data." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`Workspaces (${tenants?.length ?? 0})`} className="lg:col-span-2" padded={false}>
          <Table head={<tr><th className="th">Company</th><th className="th">Plan</th><th className="th text-right">Users</th><th className="th text-right">Rentals</th><th className="th">Status</th></tr>}>
            {tenants?.map((t) => (
              <tr key={t.id}><td className="td"><Link href={`/admin/tenants/${t.id}`} className="font-medium hover:underline">{t.name}</Link><div className="text-xs text-muted">{t.slug}</div></td>
                <td className="td text-muted">{PLAN[t.plan]}</td><td className="td text-right">{count(members, t.id)}</td><td className="td text-right">{count(rentals, t.id)}</td>
                <td className="td"><Badge tone={t.status === "active" ? "green" : "red"}>{t.status}</Badge></td></tr>
            ))}
          </Table>
        </Card>
        <Card title="Create workspace">
          <AdminForm action={createTenant} submit="Create workspace & owner" className="space-y-2">
            <input name="name" required placeholder="Company name" className="input" />
            <input name="slug" placeholder="workspace-id (optional)" className="input" />
            <select name="plan" className="input">{Object.entries(PLAN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input name="owner_name" placeholder="Owner full name" className="input" />
            <input name="owner_email" type="email" required placeholder="Owner email" className="input" />
            <p className="text-xs text-muted">Creates a clean workspace with sample shift times (11 AM–5 PM, 5 PM–11 PM), default categories and reminder rules, all editable. The owner gets a one-time link to set their own password.</p>
          </AdminForm>
        </Card>
      </div>
    </>
  );
}
