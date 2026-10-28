import Link from "next/link";
import { requireTenant, roleAtLeast } from "@/lib/auth";
import { dateTime, STATUS_LABEL } from "@/lib/format";
import { Badge, Card, EmptyState, Notice, PageHeader, Table } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { env } from "@/lib/env";
import { runNow, setPaused } from "./actions";

export const metadata = { title: "Reminders" };

export default async function RemindersPage() {
  const ctx = await requireTenant();
  const tz = ctx.settings.timezone, t = ctx.tenantId;
  const [{ data: upcoming }, { data: processed }, { data: logs }, { data: conn }, { data: rules }] = await Promise.all([
    ctx.supabase.from("scheduled_reminders").select("*, rentals(reference, clients(name))").eq("tenant_id", t).eq("status", "scheduled").order("due_at").limit(50),
    ctx.supabase.from("scheduled_reminders").select("*, rentals(reference, clients(name))").eq("tenant_id", t).neq("status", "scheduled").order("updated_at", { ascending: false }).limit(30),
    ctx.supabase.from("message_logs").select("*, rentals(reference), invoices(number)").eq("tenant_id", t).order("created_at", { ascending: false }).limit(50),
    ctx.supabase.from("messaging_connections").select("*").eq("tenant_id", t).maybeSingle(),
    ctx.supabase.from("reminder_rules").select("*").eq("tenant_id", t),
  ]);
  const live = env.whatsappSendEnabled() && conn && ["live", "test"].includes(conn.status);
  const isManager = roleAtLeast(ctx.role, "manager");
  const ruleLine = (rules ?? []).filter((r) => r.enabled && ["before_due", "at_due", "overdue"].includes(r.kind))
    .map((r) => r.kind === "before_due" ? `${r.offset_minutes} min before` : r.kind === "at_due" ? "at due time" : `${r.offset_minutes} min overdue`).join(" · ");
  const rentalOf = (x: { rentals?: unknown }) => x.rentals as { reference: string; clients?: { name: string } } | null;

  return (
    <>
      <PageHeader title="Reminders & messages" subtitle={`Return reminders: ${ruleLine || "none enabled"}`}
        actions={isManager && <>
          <ActionForm action={setPaused}><input type="hidden" name="paused" value={ctx.settings.reminders_paused ? "0" : "1"} /><SubmitButton className="btn-secondary">{ctx.settings.reminders_paused ? "Resume reminders" : "Pause reminders"}</SubmitButton></ActionForm>
          <ActionForm action={runNow}><SubmitButton pendingText="Processing…">Process due now</SubmitButton></ActionForm>
          {ctx.role === "owner" && <Link href="/settings/reminders" className="btn-ghost">Edit rules</Link>}
        </>} />
      <div className="mb-6 space-y-2">
        {live ? <Notice tone="ok">Automatic WhatsApp sending is <b>ON</b> ({conn!.status === "test" ? `test mode — only to ${conn!.test_recipient}` : "live"}) through the official WhatsApp Business Platform.</Notice>
          : <Notice tone="warn"><b>Dry-run mode — reminders are NOT sent automatically.</b> Due reminders are recorded with the exact message that would be sent. Use “Open WhatsApp” to send one manually. Automatic sending needs an official WhatsApp Business connection, approved templates and a configured scheduler.</Notice>}
        {ctx.settings.reminders_paused && <Notice tone="danger">Reminders are paused. Due jobs will be skipped until resumed.</Notice>}
        {!ctx.settings.reminders_enabled && <Notice tone="danger">Reminders are disabled in settings. No new reminder jobs are created.</Notice>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Scheduled (${upcoming?.length ?? 0})`} padded={false}>
          {upcoming?.length ? (
            <Table head={<tr><th className="th">When</th><th className="th">Rental</th><th className="th">Type</th></tr>}>
              {upcoming.map((r) => <tr key={r.id}><td className="td">{dateTime(r.due_at, tz)}{r.last_error && <div className="text-xs text-muted">{r.last_error}</div>}</td>
                <td className="td"><Link className="link" href={`/rentals/${r.rental_id}`}>{rentalOf(r)?.reference}</Link><div className="text-xs text-muted">{rentalOf(r)?.clients?.name}</div></td>
                <td className="td capitalize">{r.kind.replace(/_/g, " ")}</td></tr>)}
            </Table>
          ) : <EmptyState title="No reminders scheduled" body="Reminders are created when equipment is dispatched and cancelled when it is returned." />}
        </Card>
        <Card title="Recently processed" padded={false}>
          {processed?.length ? (
            <Table head={<tr><th className="th">Due</th><th className="th">Rental</th><th className="th">Type</th><th className="th">Result</th></tr>}>
              {processed.map((r) => <tr key={r.id}><td className="td text-muted">{dateTime(r.due_at, tz)}</td>
                <td className="td"><Link className="link" href={`/rentals/${r.rental_id}`}>{rentalOf(r)?.reference}</Link></td>
                <td className="td capitalize">{r.kind.replace(/_/g, " ")}</td>
                <td className="td"><Badge status={r.status} /><div className="max-w-48 text-xs text-muted">{r.cancel_reason ?? r.last_error ?? ""}</div></td></tr>)}
            </Table>
          ) : <EmptyState title="Nothing processed yet" />}
        </Card>
      </div>

      <Card title="Message log" className="mt-6" padded={false}>
        {logs?.length ? (
          <Table head={<tr><th className="th">Time</th><th className="th">Purpose</th><th className="th">To</th><th className="th">Status</th><th className="th">Message</th><th className="th"></th></tr>}>
            {logs.map((m) => (
              <tr key={m.id}>
                <td className="td text-muted">{dateTime(m.created_at, tz)}</td>
                <td className="td"><span className="capitalize">{m.purpose.replace(/_/g, " ")}</span><div className="text-xs text-muted">{(m.rentals as { reference: string } | null)?.reference ?? (m.invoices as { number: string } | null)?.number ?? ""} · {m.mode === "manual" ? "manual" : m.mode === "dry_run" ? "dry run" : "API"}</div></td>
                <td className="td text-muted">{m.to_phone}</td>
                <td className="td"><Badge status={m.status}>{STATUS_LABEL[m.status]}</Badge>{m.error && <div className="max-w-48 text-xs text-muted">{m.error}</div>}</td>
                <td className="td max-w-xs"><div className="line-clamp-2 text-xs text-muted">{m.body}</div></td>
                <td className="td">{m.mode === "dry_run" && m.body && <WhatsAppButton phone={m.to_phone} message={m.body} purpose={m.purpose} rentalId={m.rental_id ?? undefined} clientId={m.client_id ?? undefined} reminderId={m.reminder_id ?? undefined} label="Send manually" className="btn-secondary py-1 text-xs" />}</td>
              </tr>
            ))}
          </Table>
        ) : <EmptyState title="No messages yet" />}
      </Card>
    </>
  );
}
