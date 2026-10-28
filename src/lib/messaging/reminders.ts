import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { dateTime } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { renderTemplate } from "@/lib/whatsapp";
import { decryptSecret } from "./crypto";
import { WhatsAppCloudProvider } from "./whatsapp-cloud";
import type { MessagingProvider } from "./provider";

type Job = { id: string; tenant_id: string; rental_id: string; kind: string; due_at: string; deadline_at: string | null; attempts: number; message_log_id: string | null };
type Summary = { claimed: number; dry_run: number; sent: number; skipped: number; cancelled: number; failed: number; rescheduled: number; details: string[] };

const RETURN_KINDS = ["before_due", "at_due", "overdue"];
const MAX_ATTEMPTS = 3;
/** Default parameter order for approved templates; tenants can override per kind in messaging settings. */
export const DEFAULT_PARAMS = ["client", "company", "reference", "items", "due"];

function minutesOfDay(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const h = Number(p.find((x) => x.type === "hour")!.value) % 24, m = Number(p.find((x) => x.type === "minute")!.value);
  return h * 60 + m;
}
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

/** If `now` is inside quiet hours, returns the instant quiet hours end; otherwise null. */
export function quietHoursEnd(now: Date, tz: string, start: string | null, end: string | null): Date | null {
  if (!start || !end || start === end) return null;
  const n = minutesOfDay(now, tz), s = toMin(start), e = toMin(end);
  const inQuiet = s < e ? n >= s && n < e : n >= s || n < e;
  if (!inQuiet) return null;
  const wait = (e - n + 1440) % 1440;
  return new Date(now.getTime() + wait * 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}

/**
 * Process due reminder jobs. Safe to run concurrently and repeatedly (jobs are claimed with SKIP LOCKED,
 * each job is sent at most once, and the rental is re-checked immediately before sending).
 * Real WhatsApp messages are sent ONLY when WHATSAPP_SEND_ENABLED=true and the tenant connection is live/test
 * with credentials and an approved template. Otherwise the job is recorded as a dry run (not sent).
 */
export async function processDueReminders(opts: { tenantId?: string; limit?: number } = {}): Promise<Summary> {
  const db = createAdminClient();
  const sum: Summary = { claimed: 0, dry_run: 0, sent: 0, skipped: 0, cancelled: 0, failed: 0, rescheduled: 0, details: [] };
  const { data: jobs, error } = await db.rpc("claim_due_reminders", { p_limit: opts.limit ?? 50, p_tenant: opts.tenantId ?? null });
  if (error) throw new Error(error.message);
  sum.claimed = jobs?.length ?? 0;
  const finish = async (job: Job, status: string, patch: Record<string, unknown> = {}) => {
    await db.from("scheduled_reminders").update({ status, processed_at: new Date().toISOString(), locked_at: null, ...patch }).eq("id", job.id);
  };

  for (const job of (jobs ?? []) as Job[]) {
    try {
      // Never send twice: if a message was already queued/sent for this job, don't resend.
      const { data: prior } = await db.from("message_logs").select("id,status").eq("reminder_id", job.id).in("status", ["queued", "sent", "delivered", "read", "dry_run"]).limit(1);
      if (prior?.length) {
        await finish(job, prior[0].status === "dry_run" ? "dry_run" : "sent", { message_log_id: prior[0].id });
        continue;
      }
      const [{ data: rental }, { data: settings }, { data: rule }, { data: conn }] = await Promise.all([
        db.from("v_rentals").select("*").eq("id", job.rental_id).single(),
        db.from("tenant_settings").select("*").eq("tenant_id", job.tenant_id).single(),
        db.from("reminder_rules").select("*").eq("tenant_id", job.tenant_id).eq("kind", job.kind).single(),
        db.from("messaging_connections").select("*").eq("tenant_id", job.tenant_id).maybeSingle(),
      ]);
      if (!rental || !settings) { await finish(job, "cancelled", { cancel_reason: "Rental no longer exists" }); sum.cancelled++; continue; }

      // Re-check status right before sending.
      const out = ["dispatched", "partially_returned"].includes(rental.status);
      if (RETURN_KINDS.includes(job.kind)) {
        if (!out) { await finish(job, "cancelled", { cancel_reason: `Rental is ${rental.status}` }); sum.cancelled++; continue; }
        if (job.deadline_at && new Date(job.deadline_at).getTime() !== new Date(rental.expected_return_at).getTime()) {
          await finish(job, "cancelled", { cancel_reason: "Deadline changed" }); sum.cancelled++; continue;
        }
      }
      if (job.kind === "dispatch_confirmation" && ["cancelled", "reserved"].includes(rental.status)) { await finish(job, "cancelled", { cancel_reason: `Rental is ${rental.status}` }); sum.cancelled++; continue; }
      if (job.kind === "return_confirmation" && !["returned", "closed"].includes(rental.status)) { await finish(job, "cancelled", { cancel_reason: "Rental not returned" }); sum.cancelled++; continue; }
      if (!settings.reminders_enabled || !rule?.enabled) { await finish(job, "skipped", { last_error: "Reminders disabled" }); sum.skipped++; continue; }
      if (settings.reminders_paused) { await finish(job, "skipped", { last_error: "Reminders paused by a manager" }); sum.skipped++; continue; }

      const quietEnd = quietHoursEnd(new Date(), settings.timezone, settings.quiet_hours_start, settings.quiet_hours_end);
      if (quietEnd) {
        await db.from("scheduled_reminders").update({ status: "scheduled", due_at: quietEnd.toISOString(), locked_at: null, attempts: job.attempts - 1, last_error: "Deferred: quiet hours" }).eq("id", job.id);
        sum.rescheduled++; continue;
      }
      const { count } = await db.from("message_logs").select("id", { count: "exact", head: true }).eq("rental_id", job.rental_id).not("reminder_id", "is", null).in("status", ["queued", "sent", "delivered", "read", "dry_run"]);
      if ((count ?? 0) >= settings.max_reminders_per_rental) { await finish(job, "skipped", { last_error: `Maximum of ${settings.max_reminders_per_rental} reminders reached` }); sum.skipped++; continue; }

      const to: string | null = rental.responsible_whatsapp ?? rental.client_whatsapp;
      if (!to) { await finish(job, "failed", { last_error: "No WhatsApp number on rental or client" }); sum.failed++; continue; }

      const { data: lines } = await db.from("rental_items").select("description,quantity,asset_code").eq("rental_id", job.rental_id);
      const vars = {
        client: rental.responsible_name || rental.client_name, company: settings.company_name, reference: rental.reference,
        items: (lines ?? []).map((l) => `${l.description}${l.quantity > 1 ? ` x${l.quantity}` : ""}`).join(", "),
        due: dateTime(rental.expected_return_at, settings.timezone), company_phone: displayPhone(settings.phone) || "",
        project: rental.project_name ?? "",
      };
      const body = renderTemplate(rule.template, vars);

      // Decide delivery mode honestly.
      const tpl = (conn?.templates ?? {})[job.kind] as { name?: string; language?: string; params?: string[] } | undefined;
      let provider: MessagingProvider | null = null;
      let recipient = to;
      let mode: "dry_run" | "api" | "api_test" = "dry_run";
      let why = "";
      if (!env.whatsappSendEnabled()) why = "WHATSAPP_SEND_ENABLED is off";
      else if (!conn || !["live", "test"].includes(conn.status)) why = "WhatsApp API not connected";
      else if (!tpl?.name) why = `No approved template configured for ${job.kind}`;
      else if (conn.status === "test" && !conn.test_recipient) why = "Test mode without a test recipient";
      else {
        const { data: cred } = await db.from("messaging_credentials").select("access_token_encrypted").eq("tenant_id", job.tenant_id).maybeSingle();
        if (!cred) why = "No credentials stored";
        else {
          provider = new WhatsAppCloudProvider(conn.phone_number_id, decryptSecret(cred.access_token_encrypted));
          mode = conn.status === "test" ? "api_test" : "api";
          if (conn.status === "test") recipient = conn.test_recipient;
        }
      }

      if (!provider) {
        const { data: log } = await db.from("message_logs").insert({
          tenant_id: job.tenant_id, mode: "dry_run", status: "dry_run", purpose: `reminder_${job.kind}`, to_phone: to, body,
          rental_id: job.rental_id, client_id: rental.client_id, reminder_id: job.id, error: `Not sent: ${why}`,
        }).select("id").single();
        await finish(job, "dry_run", { message_log_id: log?.id, last_error: `Dry run: ${why}` });
        sum.dry_run++;
        continue;
      }

      const params = (tpl!.params?.length ? tpl!.params : DEFAULT_PARAMS).map((k) => String((vars as Record<string, string>)[k] ?? ""));
      const { data: log } = await db.from("message_logs").insert({
        tenant_id: job.tenant_id, mode, status: "queued", purpose: `reminder_${job.kind}`, to_phone: recipient, body,
        template_name: tpl!.name, template_params: params, rental_id: job.rental_id, client_id: rental.client_id, reminder_id: job.id,
      }).select("id").single();
      const res = await provider.sendTemplate({ to: recipient, templateName: tpl!.name!, language: tpl!.language || "en", bodyParams: params });
      if (res.ok) {
        await db.from("message_logs").update({ status: "sent", provider_message_id: res.providerMessageId, sent_at: new Date().toISOString() }).eq("id", log!.id);
        await finish(job, "sent", { message_log_id: log!.id, last_error: null });
        sum.sent++;
      } else {
        await db.from("message_logs").update({ status: "failed", error: res.error, failed_at: new Date().toISOString() }).eq("id", log!.id);
        if (res.transient && job.attempts < MAX_ATTEMPTS) {
          await db.from("scheduled_reminders").update({ status: "scheduled", due_at: new Date(Date.now() + 5 * 60000 * job.attempts).toISOString(), locked_at: null, last_error: res.error }).eq("id", job.id);
          sum.rescheduled++;
        } else {
          await finish(job, "failed", { last_error: res.error, message_log_id: log!.id });
          sum.failed++;
        }
      }
    } catch (e) {
      sum.details.push(`${job.id}: ${(e as Error).message}`);
      await db.from("scheduled_reminders").update({ status: job.attempts < MAX_ATTEMPTS ? "scheduled" : "failed", locked_at: null, last_error: (e as Error).message, due_at: new Date(Date.now() + 5 * 60000).toISOString() }).eq("id", job.id);
      sum.failed++;
    }
  }
  return sum;
}
