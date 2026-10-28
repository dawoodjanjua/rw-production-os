import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/auth";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { connectWhatsApp, disconnectWhatsApp, updateTenant } from "../../actions";
import { AdminForm } from "../../admin-form";

export default async function TenantAdmin({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  const db = createAdminClient();
  const [{ data: t }, { data: members }, { data: conn }, { data: cred }] = await Promise.all([
    db.from("tenants").select("*").eq("id", id).maybeSingle(),
    db.from("tenant_memberships").select("id,role,active,user_id").eq("tenant_id", id),
    db.from("messaging_connections").select("*").eq("tenant_id", id).maybeSingle(),
    db.from("messaging_credentials").select("token_last4,updated_at").eq("tenant_id", id).maybeSingle(),
  ]);
  if (!t) notFound();
  const { data: profiles } = await db.from("user_profiles").select("id,email,full_name").in("id", (members ?? []).map((m) => m.user_id));
  const prof = new Map((profiles ?? []).map((p) => [p.id, p]));
  return (
    <>
      <PageHeader title={t.name} subtitle={`${t.slug} · created ${new Date(t.created_at).toDateString()}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Plan & status">
          <AdminForm action={updateTenant} submit="Save" className="space-y-2">
            <input type="hidden" name="id" value={t.id} />
            <label className="block"><span className="label">Plan (billed manually for the pilot)</span><select name="plan" defaultValue={t.plan} className="input"><option value="starter">Starter · PKR 5,000/mo</option><option value="professional">Professional · PKR 10,000/mo</option><option value="white_label">White-label · PKR 20,000+/mo</option></select></label>
            <label className="block"><span className="label">Status</span><select name="status" defaultValue={t.status} className="input"><option value="active">Active</option><option value="suspended">Suspended (users lose access)</option></select></label>
            <label className="block"><span className="label">Billing notes</span><textarea name="plan_notes" defaultValue={t.plan_notes ?? ""} rows={2} className="input" /></label>
          </AdminForm>
        </Card>
        <Card title="Users" padded={false}>
          <Table head={<tr><th className="th">User</th><th className="th">Role</th><th className="th">Status</th></tr>}>
            {members?.map((m) => { const p = prof.get(m.user_id); return (
              <tr key={m.id}><td className="td">{p?.full_name || p?.email}<div className="text-xs text-muted">{p?.email}</div></td><td className="td capitalize">{m.role}</td><td className="td"><Badge tone={m.active ? "green" : "gray"}>{m.active ? "active" : "inactive"}</Badge></td></tr>); })}
          </Table>
          <p className="p-4 text-xs text-muted">The company owner manages staff from Settings → Team.</p>
        </Card>
        <Card title="WhatsApp Business connection" className="lg:col-span-2">
          <p className="mb-3 text-sm text-muted">Status: <b>{conn?.status ?? "not_connected"}</b>{cred && <> · token ending …{cred.token_last4}, updated {new Date(cred.updated_at).toLocaleString()}</>}. Enter the tenant&apos;s own WhatsApp Cloud API details after they complete Meta onboarding. The token is encrypted (AES-256-GCM) and can never be read back.</p>
          <AdminForm action={connectWhatsApp} submit="Save connection" className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="tenant_id" value={t.id} />
            <input name="phone_number_id" required defaultValue={conn?.phone_number_id ?? ""} placeholder="Phone number ID" className="input" />
            <input name="waba_id" defaultValue={conn?.waba_id ?? ""} placeholder="WhatsApp Business Account ID" className="input" />
            <input name="display_phone_number" defaultValue={conn?.display_phone_number ?? ""} placeholder="Display number, e.g. +92 300 1234567" className="input" />
            <input name="access_token" type="password" autoComplete="off" placeholder={cred ? "Leave empty to keep current token" : "System user access token"} className="input" />
          </AdminForm>
          {cred && <AdminForm action={disconnectWhatsApp} submit="Disconnect & delete token" className="mt-4 border-t border-line pt-4"><input type="hidden" name="tenant_id" value={t.id} /></AdminForm>}
        </Card>
      </div>
    </>
  );
}
