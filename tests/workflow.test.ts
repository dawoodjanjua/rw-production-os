/**
 * Core workflow tests against local Supabase: deadlines, pricing, availability, partial returns,
 * late fees, invoices, payments, reminders and role permissions.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { addMember, admin, buildInventory, makeTenant, makeUser, type TestUser } from "./helpers";

let owner: TestUser, manager: TestUser, staff: TestUser;
let tenant: string;
let inv: Awaited<ReturnType<typeof buildInventory>>;

const avail = async (itemId: string) => {
  const { data } = await owner.client.from("v_equipment_availability").select("qty_available,qty_out,qty_reserved,qty_unavailable").eq("id", itemId).single();
  return data!;
};
const rental = async (id: string) => (await owner.client.from("v_rentals").select("*").eq("id", id).single()).data!;
const items = async (id: string) => (await owner.client.from("rental_items").select("*").eq("rental_id", id).order("asset_code")).data!;

beforeAll(async () => {
  [owner, manager, staff] = await Promise.all([makeUser("owner"), makeUser("manager"), makeUser("staff")]);
  tenant = await makeTenant("Workflow Rentals", owner);
  await addMember(tenant, manager, "manager");
  await addMember(tenant, staff, "staff");
  inv = await buildInventory(owner, tenant);
});

describe("deadlines and pricing", () => {
  it("shift rental ends at the shift end in the tenant timezone", async () => {
    const { data, error } = await owner.client.rpc("quote_rental", { p: {
      tenant_id: tenant, rental_type: "shift", shift_rule_id: inv.shiftA.id, units: 1,
      start_at: "2026-11-02T06:00:00Z", // 11:00 Asia/Karachi
      items: [{ item_id: inv.cam.id, quantity: 1 }, { item_id: inv.grip.id, quantity: 2 }],
    } });
    expect(error).toBeNull();
    expect(new Date(data.expected_return_at).toISOString()).toBe("2026-11-02T12:00:00.000Z"); // 17:00 PKT
    expect(data.lines[0].line_total).toBe(12000);
    expect(data.lines[1].line_total).toBe(3000);
    expect(data.subtotal).toBe(15000);
  });

  it("a shift crossing midnight ends the next day, multiple shifts add days", async () => {
    await owner.client.from("shift_rules").update({ start_time: "20:00", end_time: "06:00", rate_multiplier: 1.5 }).eq("id", inv.shiftB.id);
    const { data } = await owner.client.rpc("quote_rental", { p: {
      tenant_id: tenant, rental_type: "shift", shift_rule_id: inv.shiftB.id, units: 2, shift_date: "2026-11-02",
      start_at: "2026-11-02T15:00:00Z", items: [{ item_id: inv.cam.id, quantity: 1 }],
    } });
    // Night shift on Nov 2 and Nov 3, ending 06:00 PKT on Nov 4 = 01:00Z.
    expect(new Date(data.expected_return_at).toISOString()).toBe("2026-11-04T01:00:00.000Z");
    expect(data.lines[0].unit_rate).toBe(18000); // 12000 × 1.5 night multiplier
    expect(data.lines[0].line_total).toBe(36000);
    expect(data.lines[0].rate_source).toContain("1.5");
  });

  it("full-day rentals keep wall-clock time across a DST change", async () => {
    await owner.client.from("tenant_settings").update({ timezone: "America/New_York" }).eq("tenant_id", tenant);
    const { data } = await owner.client.rpc("quote_rental", { p: {
      tenant_id: tenant, rental_type: "full_day", units: 1, start_at: "2026-10-31T14:00:00Z", // 10:00 EDT
      items: [{ item_id: inv.grip.id, quantity: 1 }],
    } });
    // DST ends Nov 1: 10:00 EST next day = 15:00Z (25 real hours).
    expect(new Date(data.expected_return_at).toISOString()).toBe("2026-11-01T15:00:00.000Z");
    await owner.client.from("tenant_settings").update({ timezone: "Asia/Karachi" }).eq("tenant_id", tenant);
  });

  it("without a chosen date, a shift rental uses the next shift that has not ended", async () => {
    const q = async (start: string) => (await owner.client.rpc("quote_rental", { p: { tenant_id: tenant, rental_type: "shift",
      shift_rule_id: inv.shiftA.id, units: 1, start_at: start, items: [{ item_id: inv.grip.id, quantity: 1 }] } })).data;
    // Shift A is 11:00–17:00 PKT. Dispatch 10:00 PKT → today 17:00; dispatch 20:00 PKT → tomorrow 17:00.
    expect(new Date((await q("2026-11-02T05:00:00Z")).expected_return_at).toISOString()).toBe("2026-11-02T12:00:00.000Z");
    const evening = await q("2026-11-02T15:00:00Z");
    expect(evening.shift_date).toBe("2026-11-03");
    expect(new Date(evening.expected_return_at).toISOString()).toBe("2026-11-03T12:00:00.000Z");
  });

  it("custom duration bills per started day", async () => {
    const { data } = await owner.client.rpc("quote_rental", { p: {
      tenant_id: tenant, rental_type: "custom", start_at: "2026-11-02T06:00:00Z", custom_return_at: "2026-11-03T10:00:00Z",
      items: [{ item_id: inv.grip.id, quantity: 1 }],
    } });
    expect(data.units).toBe(2);
    expect(data.lines[0].line_total).toBe(5000);
  });

  it("staff cannot override rates or apply discounts; managers can", async () => {
    const base = { tenant_id: tenant, rental_type: "full_day", units: 1, items: [{ item_id: inv.grip.id, quantity: 1, unit_rate_override: 1 }] };
    expect((await staff.client.rpc("quote_rental", { p: base })).error).not.toBeNull();
    const m = await manager.client.rpc("quote_rental", { p: base });
    expect(m.error).toBeNull();
    expect(m.data.lines[0].unit_rate).toBe(1);
  });
});

describe("dispatch, availability and returns", () => {
  let rid: string;

  it("staff can dispatch; availability drops", async () => {
    const { data, error } = await staff.client.rpc("create_rental", { p: {
      tenant_id: tenant, client_id: inv.client.id, project_name: "Brand film shoot", rental_type: "shift",
      shift_rule_id: inv.shiftA.id, units: 2, dispatch_now: true, responsible_whatsapp: "+923331112223",
      items: [{ item_id: inv.cam.id, quantity: 2 }, { item_id: inv.grip.id, quantity: 3 }],
    } });
    expect(error).toBeNull();
    rid = data;
    const r = await rental(rid);
    expect(r.status).toBe("dispatched");
    expect(r.reference).toMatch(/^RNT-\d{4}$/);
    expect(Number(r.total)).toBe(2 * (2 * 12000 + 3 * 1500));
    expect(new Date(r.expected_return_at).getTime()).toBeGreaterThan(Date.now());
    expect((await avail(inv.cam.id)).qty_available).toBe(0);
    expect((await avail(inv.grip.id)).qty_available).toBe(1);
    const { data: proj } = await owner.client.from("projects").select("name").eq("tenant_id", tenant);
    expect(proj!.map((p) => p.name)).toContain("Brand film shoot");
  });

  it("cannot dispatch more than is available", async () => {
    const r1 = await owner.client.rpc("create_rental", { p: { tenant_id: tenant, client_id: inv.client.id, rental_type: "full_day", units: 1,
      items: [{ item_id: inv.grip.id, quantity: 2 }] } });
    expect(r1.error?.message).toMatch(/Only 1 unit/);
    const r2 = await owner.client.rpc("create_rental", { p: { tenant_id: tenant, client_id: inv.client.id, rental_type: "full_day", units: 1,
      items: [{ item_id: inv.cam.id, quantity: 1 }] } });
    expect(r2.error?.message).toMatch(/Only 0 unit/);
  });

  it("reservations hold stock until cancelled", async () => {
    const { data: res } = await owner.client.rpc("create_rental", { p: { tenant_id: tenant, client_id: inv.client.id,
      rental_type: "full_day", units: 1, dispatch_now: false, items: [{ item_id: inv.grip.id, quantity: 1 }] } });
    expect((await rental(res)).status).toBe("reserved");
    expect((await avail(inv.grip.id)).qty_available).toBe(0);
    expect((await staff.client.rpc("cancel_rental", { p_rental: res })).error).not.toBeNull(); // staff cannot cancel
    expect((await manager.client.rpc("cancel_rental", { p_rental: res })).error).toBeNull();
    expect((await avail(inv.grip.id)).qty_available).toBe(1);
  });

  it("schedules reminders on dispatch", async () => {
    const { data } = await owner.client.from("scheduled_reminders").select("kind,status").eq("rental_id", rid);
    expect(data!.filter((x) => x.status === "scheduled").map((x) => x.kind).sort()).toEqual(["at_due", "before_due", "overdue"].sort());
  });

  it("partial return: rejects over-returns, updates availability, keeps rental open", async () => {
    const lines = await items(rid);
    const grip = lines.find((l) => l.item_id === inv.grip.id)!;
    const over = await staff.client.rpc("record_return", { p: { rental_id: rid, lines: [{ rental_item_id: grip.id, returned: 4 }] } });
    expect(over.error?.message).toMatch(/only 3 outstanding/);
    const cam1 = lines.find((l) => l.asset_code === "CAM-001")!;
    const { data, error } = await staff.client.rpc("record_return", { p: { rental_id: rid,
      lines: [{ rental_item_id: grip.id, returned: 2, damaged: 1 }, { rental_item_id: cam1.id, returned: 1 }] } });
    expect(error).toBeNull();
    expect(data.status).toBe("partially_returned");
    expect(data.remaining).toBe(2);
    const g = await avail(inv.grip.id);
    expect(g.qty_available).toBe(2); // 4 total − 1 still out − 1 damaged
    expect(g.qty_unavailable).toBe(1);
    expect((await avail(inv.cam.id)).qty_available).toBe(1);
    // Reminders still scheduled while equipment is out.
    const { data: rem } = await owner.client.from("scheduled_reminders").select("status").eq("rental_id", rid).eq("status", "scheduled");
    expect(rem!.length).toBe(3);
  });

  it("extension reprices from the snapshot and reschedules reminders", async () => {
    // Change the live rate: the rental must keep its snapshot.
    await owner.client.from("equipment_items").update({ shift_rate: 99999 }).eq("id", inv.cam.id);
    const before = await rental(rid);
    expect((await staff.client.rpc("extend_rental", { p_rental: rid, p_additional_units: 1 })).error).not.toBeNull();
    const { error } = await manager.client.rpc("extend_rental", { p_rental: rid, p_additional_units: 1, p_reason: "Shoot ran over" });
    expect(error).toBeNull();
    const after = await rental(rid);
    expect(after.units).toBe(3);
    expect(new Date(after.expected_return_at).getTime() - new Date(before.expected_return_at).getTime()).toBe(86400000);
    expect(Number(after.subtotal)).toBe(3 * (2 * 12000 + 3 * 1500));
    const { data: rem } = await owner.client.from("scheduled_reminders").select("status,deadline_at").eq("rental_id", rid);
    const active = rem!.filter((x) => x.status === "scheduled");
    expect(active.length).toBe(3);
    expect(active.every((x) => new Date(x.deadline_at).getTime() === new Date(after.expected_return_at).getTime())).toBe(true);
    expect(rem!.filter((x) => x.status === "cancelled").length).toBe(3);
    const { data: ev } = await owner.client.from("rental_events").select("event_type").eq("rental_id", rid);
    expect(ev!.map((e) => e.event_type)).toEqual(expect.arrayContaining(["reserved", "dispatched", "partial_return", "extended"]));
    await owner.client.from("equipment_items").update({ shift_rate: 12000 }).eq("id", inv.cam.id);
  });

  it("final return closes the rental, releases stock, cancels reminders", async () => {
    const lines = await items(rid);
    const grip = lines.find((l) => l.item_id === inv.grip.id)!;
    const cam2 = lines.find((l) => l.asset_code === "CAM-002")!;
    const { data, error } = await staff.client.rpc("record_return", { p: { rental_id: rid,
      lines: [{ rental_item_id: grip.id, returned: 0, missing: 1 }, { rental_item_id: cam2.id, returned: 1 }] } });
    expect(error).toBeNull();
    expect(data.status).toBe("returned");
    expect(data.late_fee).toBe(0); // no late fee configured
    expect((await avail(inv.cam.id)).qty_available).toBe(2);
    const g = await avail(inv.grip.id);
    expect(g.qty_available).toBe(2); // 1 damaged + 1 missing out of service
    const { data: rem } = await owner.client.from("scheduled_reminders").select("status").eq("rental_id", rid).eq("status", "scheduled");
    expect(rem).toEqual([]);
    const again = await staff.client.rpc("record_return", { p: { rental_id: rid, lines: [{ rental_item_id: cam2.id, returned: 1 }] } });
    expect(again.error).not.toBeNull();
  });

  it("asset status cannot be forced while on rent", async () => {
    const { data: rid2 } = await owner.client.rpc("create_rental", { p: { tenant_id: tenant, client_id: inv.client.id,
      rental_type: "full_day", units: 1, items: [{ item_id: inv.cam.id, quantity: 1 }] } });
    const [line] = await items(rid2);
    const { error } = await owner.client.from("equipment_assets").update({ status: "available" }).eq("id", line.asset_id);
    expect(error?.message).toMatch(/linked to a rental/);
    await owner.client.rpc("record_return", { p: { rental_id: rid2, lines: [{ rental_item_id: line.id, returned: 1 }] } });
  });
});

describe("late fees follow the tenant configuration only", () => {
  it("applies a configured per-unit hourly late fee, visible as a charge", async () => {
    await owner.client.from("tenant_settings").update({ late_fee_mode: "per_unit_per_hour", late_fee_amount: 500, grace_minutes: 30 }).eq("tenant_id", tenant);
    const start = new Date(Date.now() - 5 * 3600_000).toISOString();
    const due = new Date(Date.now() - 2.5 * 3600_000).toISOString();
    const { data: rid, error } = await owner.client.rpc("create_rental", { p: { tenant_id: tenant, client_id: inv.client.id,
      rental_type: "custom", start_at: start, custom_return_at: due, items: [{ item_id: inv.grip.id, quantity: 2 }] } });
    expect(error).toBeNull();
    expect((await rental(rid)).is_overdue).toBe(true);
    const [line] = await items(rid);
    const { data } = await staff.client.rpc("record_return", { p: { rental_id: rid, lines: [{ rental_item_id: line.id, returned: 2 }] } });
    expect(data.late_fee).toBe(3 * 500 * 2); // 2.5h late → 3 started hours × 500 × 2 units
    const { data: charges } = await owner.client.from("rental_charges").select("kind,amount,calculation").eq("rental_id", rid);
    expect(charges![0].kind).toBe("late_fee");
    expect(charges![0].calculation.grace_minutes).toBe(30);
    await owner.client.from("tenant_settings").update({ late_fee_mode: "none" }).eq("tenant_id", tenant);
  });
});

describe("invoices and payments", () => {
  let rid: string, iid: string;

  beforeAll(async () => {
    const { data } = await owner.client.rpc("create_rental", { p: { tenant_id: tenant, client_id: inv.client.id,
      rental_type: "full_day", units: 2, deposit_amount: 5000, discount_amount: 1000,
      items: [{ item_id: inv.cam.id, quantity: 1 }] } });
    rid = data;
  });

  it("staff cannot create invoices", async () => {
    expect((await staff.client.rpc("create_invoice_from_rental", { p_rental: rid })).error).not.toBeNull();
  });

  it("invoice from rental snapshots lines and applies the deposit", async () => {
    const { data, error } = await manager.client.rpc("create_invoice_from_rental", { p_rental: rid });
    expect(error).toBeNull();
    iid = data;
    const { data: i } = await owner.client.from("v_invoices").select("*").eq("id", iid).single();
    expect(i!.status).toBe("draft");
    expect(i!.number).toMatch(/^[A-Z0-9]+-\d{4}-\d{3}$/);
    expect(Number(i!.subtotal)).toBe(40000);
    expect(Number(i!.total)).toBe(39000);
    expect(Number(i!.amount_paid)).toBe(5000);
    expect((await manager.client.rpc("create_invoice_from_rental", { p_rental: rid })).error?.message).toMatch(/already has an invoice/);
  });

  it("payments before issue are rejected; issuing snapshots company details", async () => {
    expect((await manager.client.rpc("record_payment", { p_invoice: iid, p_amount: 100 })).error?.message).toMatch(/Issue the invoice/);
    expect((await manager.client.rpc("issue_invoice", { p_invoice: iid })).error).toBeNull();
    await owner.client.from("tenant_settings").update({ company_name: "Renamed Co" }).eq("tenant_id", tenant);
    const { data: i } = await owner.client.from("invoices").select("company_snapshot,status").eq("id", iid).single();
    expect(i!.company_snapshot.company_name).toBe("Workflow Rentals");
    expect(i!.status).toBe("partially_paid");
  });

  it("partial payments, overpayment protection, paid status", async () => {
    expect((await manager.client.rpc("record_payment", { p_invoice: iid, p_amount: 10000, p_method: "bank_transfer" })).error).toBeNull();
    let { data: i } = await owner.client.from("v_invoices").select("balance,status").eq("id", iid).single();
    expect(Number(i!.balance)).toBe(24000);
    expect(i!.status).toBe("partially_paid");
    expect((await manager.client.rpc("record_payment", { p_invoice: iid, p_amount: 24001 })).error?.message).toMatch(/exceeds/);
    expect((await staff.client.rpc("record_payment", { p_invoice: iid, p_amount: 1 })).error).not.toBeNull();
    expect((await manager.client.rpc("record_payment", { p_invoice: iid, p_amount: 24000 })).error).toBeNull();
    ({ data: i } = await owner.client.from("v_invoices").select("balance,status").eq("id", iid).single());
    expect(Number(i!.balance)).toBe(0);
    expect(i!.status).toBe("paid");
    const { data: pays } = await owner.client.from("payments").select("amount").eq("invoice_id", iid);
    expect(pays!.length).toBe(3);
  });

  it("issued invoices are immutable and payments are audited", async () => {
    const { error } = await manager.client.rpc("update_invoice_draft", { p: { invoice_id: iid, client_id: inv.client.id, items: [] } });
    expect(error?.message).toMatch(/Only draft/);
    const { data: audit } = await owner.client.from("audit_logs").select("entity").eq("tenant_id", tenant).eq("entity", "payments");
    expect(audit!.length).toBeGreaterThanOrEqual(3);
    expect((await staff.client.from("audit_logs").select("id").eq("tenant_id", tenant)).data).toEqual([]);
  });
});

describe("reminders", () => {
  it("claims due jobs exactly once and never for returned rentals", async () => {
    const start = new Date(Date.now() - 3 * 3600_000).toISOString();
    const due = new Date(Date.now() + 30 * 60_000).toISOString();
    const { data: rid } = await owner.client.rpc("create_rental", { p: { tenant_id: tenant, client_id: inv.client.id,
      rental_type: "custom", start_at: start, custom_return_at: due, items: [{ item_id: inv.grip.id, quantity: 1 }] } });
    const { data: rem } = await owner.client.from("scheduled_reminders").select("kind,due_at,status").eq("rental_id", rid);
    // 60-min-before reminder is already in the past → not backfilled.
    expect(rem!.map((r) => r.kind).sort()).toEqual(["at_due", "overdue"]);
    // Force one job due now and claim it twice concurrently.
    await admin.from("scheduled_reminders").update({ due_at: new Date(Date.now() - 1000).toISOString() }).eq("rental_id", rid).eq("kind", "at_due");
    const [a, b] = await Promise.all([
      admin.rpc("claim_due_reminders", { p_limit: 10, p_tenant: tenant }),
      admin.rpc("claim_due_reminders", { p_limit: 10, p_tenant: tenant }),
    ]);
    const claimed = [...(a.data ?? []), ...(b.data ?? [])].filter((r: { rental_id: string }) => r.rental_id === rid);
    expect(claimed.length).toBe(1);
  });

  it("managers can pause reminders; staff cannot", async () => {
    expect((await staff.client.rpc("set_reminders_paused", { p_tenant: tenant, p_paused: true })).error).not.toBeNull();
    expect((await manager.client.rpc("set_reminders_paused", { p_tenant: tenant, p_paused: true })).error).toBeNull();
    const { data } = await owner.client.from("tenant_settings").select("reminders_paused").eq("tenant_id", tenant).single();
    expect(data!.reminders_paused).toBe(true);
  });
});

describe("permissions", () => {
  it("staff cannot edit equipment, settings or shifts", async () => {
    const { data: e } = await staff.client.from("equipment_items").update({ name: "x" }).eq("id", inv.grip.id).select();
    expect(e ?? []).toEqual([]);
    const { data: s } = await staff.client.from("tenant_settings").update({ company_name: "x" }).eq("tenant_id", tenant).select();
    expect(s ?? []).toEqual([]);
    const { data: m } = await manager.client.from("shift_rules").update({ name: "x" }).eq("id", inv.shiftA.id).select();
    expect(m ?? []).toEqual([]);
    const { error } = await staff.client.from("clients").insert({ tenant_id: tenant, name: "Walk-in client" });
    expect(error).toBeNull(); // staff may add clients at the counter
  });

  it("the last owner cannot be removed", async () => {
    const { error } = await admin.from("tenant_memberships").update({ role: "staff" }).eq("tenant_id", tenant).eq("user_id", owner.id);
    expect(error?.message).toMatch(/at least one active owner/);
  });
});

describe("tenant deletion", () => {
  it("deleting a tenant removes all of its data (platform operation)", async () => {
    const o = await makeUser("deleteme");
    const t = await makeTenant("Delete Me Rentals", o);
    const inv2 = await buildInventory(o, t);
    await o.client.rpc("create_rental", { p: { tenant_id: t, client_id: inv2.client.id, rental_type: "full_day", units: 1, items: [{ item_id: inv2.grip.id, quantity: 1 }] } });
    const { error } = await admin.from("tenants").delete().eq("id", t);
    expect(error).toBeNull();
    const { count } = await admin.from("rentals").select("*", { count: "exact", head: true }).eq("tenant_id", t);
    expect(count).toBe(0);
  });
});
