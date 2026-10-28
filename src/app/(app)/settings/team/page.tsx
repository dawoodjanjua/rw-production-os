import { requireTenant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge, Card, Notice, Table } from "@/components/ui";
import { addMember, updateMember } from "../actions";
import { LinkForm } from "./invite";

export const metadata = { title: "Team" };

const ROLE_HELP = [
  ["Owner", "Everything, including company settings, shifts, team, voiding invoices and removing payments."],
  ["Manager", "Equipment, clients, rentals, extensions, charges, invoices and payments. Can pause reminders."],
  ["Staff", "Dispatch and return equipment, add clients, share messages. Cannot change prices, invoices or settings."],
];

export default async function TeamPage() {
  const ctx = await requireTenant();
  const { data: members } = await ctx.supabase.from("tenant_memberships").select("id,user_id,role,active,created_at").eq("tenant_id", ctx.tenantId).order("created_at");
  // Emails come from profiles; read with service role after confirming the caller is a member of this tenant.
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length ? await createAdminClient().from("user_profiles").select("id,email,full_name").in("id", ids) : { data: [] };
  const prof = new Map((profiles ?? []).map((p) => [p.id, p]));
  const owner = ctx.role === "owner";

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Team members" className="lg:col-span-2" padded={false}>
        <Table head={<tr><th className="th">Person</th><th className="th">Role</th><th className="th">Status</th>{owner && <th className="th">Manage</th>}</tr>}>
          {members?.map((m) => {
            const p = prof.get(m.user_id);
            const self = m.user_id === ctx.user.id;
            return (
              <tr key={m.id}>
                <td className="td"><div className="font-medium">{p?.full_name || p?.email}{self && <span className="text-muted"> (you)</span>}</div><div className="text-xs text-muted">{p?.email}</div></td>
                <td className="td capitalize">{m.role}</td>
                <td className="td"><Badge tone={m.active ? "green" : "gray"}>{m.active ? "Active" : "Deactivated"}</Badge></td>
                {owner && (
                  <td className="td">
                    <div className="flex flex-wrap gap-2">
                      <LinkForm action={updateMember} className="flex gap-1">
                        <input type="hidden" name="membership_id" value={m.id} /><input type="hidden" name="op" value="role" />
                        <select name="role" defaultValue={m.role} className="input w-28 py-1">{["owner", "manager", "staff"].map((r) => <option key={r}>{r}</option>)}</select>
                        <button className="btn-secondary py-1">Set</button>
                      </LinkForm>
                      <LinkForm action={updateMember}><input type="hidden" name="membership_id" value={m.id} /><input type="hidden" name="op" value="link" /><button className="btn-ghost py-1">Password link</button></LinkForm>
                      {!self && <LinkForm action={updateMember}><input type="hidden" name="membership_id" value={m.id} /><input type="hidden" name="op" value={m.active ? "deactivate" : "activate"} /><button className="btn-ghost py-1">{m.active ? "Deactivate" : "Reactivate"}</button></LinkForm>}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </Table>
      </Card>
      <div className="space-y-6">
        {owner ? (
          <Card title="Add team member">
            <LinkForm action={addMember} className="space-y-2">
              <input name="full_name" placeholder="Full name" className="input" />
              <input name="email" type="email" required placeholder="Email" className="input" />
              <select name="role" defaultValue="staff" className="input"><option value="staff">Staff</option><option value="manager">Manager</option><option value="owner">Owner</option></select>
              <button className="btn-primary w-full">Add & create setup link</button>
              <p className="text-xs text-muted">You will get a one-time link to send them (e.g. on WhatsApp). They choose their own password; no shared passwords are created.</p>
            </LinkForm>
          </Card>
        ) : <Notice tone="info">Only the owner can manage the team.</Notice>}
        <Card title="Roles">
          <dl className="space-y-3 text-sm">{ROLE_HELP.map(([r, d]) => <div key={r}><dt className="font-medium">{r}</dt><dd className="text-muted">{d}</dd></div>)}</dl>
        </Card>
      </div>
    </div>
  );
}
