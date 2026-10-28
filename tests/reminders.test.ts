/**
 * Reminder processor tests (dry-run mode) against local Supabase.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { admin, buildInventory, makeTenant, makeUser, type TestUser } from "./helpers";
import { processDueReminders, quietHoursEnd } from "@/lib/messaging/reminders";

let owner: TestUser, tenant: string;
let inv: Awaited<ReturnType<typeof buildInventory>>;

async function rentalWithDueJob() {
  const start = new Date(Date.now() - 2 * 3600_000).toISOString();
  const due = new Date(Date.now() + 2 * 3600_000).toISOString();
  const { data: rid, error } = await owner.client.rpc("create_rental", { p: { tenant_id: tenant, client_id: inv.client.id, rental_type: "custom",
    start_at: start, custom_return_at: due, responsible_whatsapp: "+923009990000", items: [{ item_id: inv.grip.id, quantity: 1 }] } });
  if (error) throw error;
  // Simulate the passage of time: make the "before_due" job due now.
  await admin.from("scheduled_reminders").update({ due_at: new Date(Date.now() - 1000).toISOString() }).eq("rental_id", rid).eq("kind", "before_due");
  return rid as string;
}
const job = async (rid: string, kind = "before_due") => (await admin.from("scheduled_reminders").select("*").eq("rental_id", rid).eq("kind", kind).single()).data!;

beforeAll(async () => {
  process.env.WHATSAPP_SEND_ENABLED = "false";
  owner = await makeUser("rem-owner");
  tenant = await makeTenant("Reminder Rentals", owner);
  inv = await buildInventory(owner, tenant);
  await admin.from("tenant_settings").update({ quiet_hours_start: null, quiet_hours_end: null }).eq("tenant_id", tenant);
});

describe("reminder processing (dry run)", () => {
  it("records a due reminder as a dry run with the rendered message, and never sends twice", async () => {
    const rid = await rentalWithDueJob();
    const s = await processDueReminders({ tenantId: tenant });
    expect(s.dry_run).toBe(1);
    const j = await job(rid);
    expect(j.status).toBe("dry_run");
    const { data: logs } = await admin.from("message_logs").select("*").eq("reminder_id", j.id);
    expect(logs!.length).toBe(1);
    expect(logs![0].status).toBe("dry_run");
    expect(logs![0].to_phone).toBe("+923009990000");
    expect(logs![0].body).toMatch(/RNT-\d{4}/);
    expect(logs![0].body).toContain("Reminder Rentals");
    expect(logs![0].error).toMatch(/Not sent/);
    // Re-running does nothing more.
    const again = await processDueReminders({ tenantId: tenant });
    expect(again.claimed).toBe(0);
    expect((await admin.from("message_logs").select("id").eq("reminder_id", j.id)).data!.length).toBe(1);
  });

  it("cancels a due reminder if the rental was returned before it ran", async () => {
    const rid = await rentalWithDueJob();
    // Return through the API first, then simulate a stale job that the return didn't cancel.
    const { data: lines } = await owner.client.from("rental_items").select("id").eq("rental_id", rid);
    await owner.client.rpc("record_return", { p: { rental_id: rid, lines: [{ rental_item_id: lines![0].id, returned: 1 }] } });
    expect((await job(rid)).status).toBe("cancelled"); // cancelled by the return itself
    await admin.from("scheduled_reminders").update({ status: "scheduled" }).eq("rental_id", rid).eq("kind", "before_due");
    const s = await processDueReminders({ tenantId: tenant });
    expect(s.cancelled).toBeGreaterThanOrEqual(1);
    expect((await job(rid)).cancel_reason).toMatch(/returned/);
    expect((await admin.from("message_logs").select("id").eq("rental_id", rid)).data!.length).toBe(0);
  });

  it("skips reminders while paused", async () => {
    const rid = await rentalWithDueJob();
    await admin.from("tenant_settings").update({ reminders_paused: true }).eq("tenant_id", tenant);
    await processDueReminders({ tenantId: tenant });
    const j = await job(rid);
    expect(j.status).toBe("skipped");
    expect(j.last_error).toMatch(/paused/);
    await admin.from("tenant_settings").update({ reminders_paused: false }).eq("tenant_id", tenant);
  });

  it("defers reminders during quiet hours", async () => {
    const rid = await rentalWithDueJob();
    await admin.from("tenant_settings").update({ quiet_hours_start: "00:00", quiet_hours_end: "23:59" }).eq("tenant_id", tenant);
    const s = await processDueReminders({ tenantId: tenant });
    expect(s.rescheduled).toBe(1);
    const j = await job(rid);
    expect(j.status).toBe("scheduled");
    expect(new Date(j.due_at).getTime()).toBeGreaterThan(Date.now());
    await admin.from("tenant_settings").update({ quiet_hours_start: null, quiet_hours_end: null }).eq("tenant_id", tenant);
  });

  it("respects the maximum reminders per rental", async () => {
    const rid = await rentalWithDueJob();
    await admin.from("tenant_settings").update({ max_reminders_per_rental: 0 }).eq("tenant_id", tenant);
    await processDueReminders({ tenantId: tenant });
    expect((await job(rid)).status).toBe("skipped");
    await admin.from("tenant_settings").update({ max_reminders_per_rental: 5 }).eq("tenant_id", tenant);
  });

  it("only processes the requested tenant", async () => {
    const other = await makeUser("rem-other");
    const t2 = await makeTenant("Other Reminder Co", other);
    const inv2 = await buildInventory(other, t2);
    const { data: rid2 } = await other.client.rpc("create_rental", { p: { tenant_id: t2, client_id: inv2.client.id, rental_type: "custom",
      start_at: new Date(Date.now() - 3600_000).toISOString(), custom_return_at: new Date(Date.now() + 7200_000).toISOString(), items: [{ item_id: inv2.grip.id, quantity: 1 }] } });
    await admin.from("scheduled_reminders").update({ due_at: new Date(Date.now() - 1000).toISOString() }).eq("rental_id", rid2).eq("kind", "before_due");
    await processDueReminders({ tenantId: tenant });
    expect((await job(rid2)).status).toBe("scheduled");
  });
});

describe("quiet hours helper", () => {
  it("handles windows crossing midnight", () => {
    const at = (iso: string) => new Date(iso);
    // 23:30 PKT = 18:30Z, quiet 23:00–08:00 → ends 08:00 PKT = 03:00Z next day
    expect(quietHoursEnd(at("2026-11-02T18:30:00Z"), "Asia/Karachi", "23:00", "08:00")?.toISOString()).toBe("2026-11-03T03:00:00.000Z");
    expect(quietHoursEnd(at("2026-11-02T07:00:00Z"), "Asia/Karachi", "23:00", "08:00")).toBeNull(); // 12:00 PKT
    expect(quietHoursEnd(at("2026-11-02T07:00:00Z"), "Asia/Karachi", null, null)).toBeNull();
  });
});
