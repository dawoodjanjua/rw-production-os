/**
 * Tenant isolation tests — run against local Supabase (`npx supabase start`).
 * Proves that a user of Tenant A cannot read, create, change or delete Tenant B's data,
 * through tables, views, RPC functions or file storage.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON, URL, addMember, admin, buildInventory, makeTenant, makeUser, type TestUser } from "./helpers";

let ownerA: TestUser, staffA: TestUser, ownerB: TestUser;
let tenantA: string, tenantB: string;
let b: Awaited<ReturnType<typeof buildInventory>>;
let rentalB: string, invoiceB: string;

const TENANT_TABLES = [
  "tenant_settings", "tenant_memberships", "shift_rules", "equipment_categories", "equipment_items",
  "equipment_assets", "clients", "suppliers", "projects", "rentals", "rental_items", "rental_charges",
  "rental_events", "invoices", "invoice_items", "payments", "reminder_rules", "scheduled_reminders",
  "messaging_connections", "message_logs", "audit_logs",
];
const VIEWS = ["v_equipment_availability", "v_rentals", "v_invoices"];

beforeAll(async () => {
  [ownerA, staffA, ownerB] = await Promise.all([makeUser("ownerA"), makeUser("staffA"), makeUser("ownerB")]);
  tenantA = await makeTenant("Alpha Rentals", ownerA);
  tenantB = await makeTenant("Bravo Rentals", ownerB);
  await addMember(tenantA, staffA, "staff");
  await buildInventory(ownerA, tenantA);
  b = await buildInventory(ownerB, tenantB);

  const { data: rid, error } = await ownerB.client.rpc("create_rental", { p: {
    tenant_id: tenantB, client_id: b.client.id, rental_type: "full_day", units: 1, dispatch_now: true,
    deposit_amount: 1000, items: [{ item_id: b.cam.id, quantity: 1 }, { item_id: b.grip.id, quantity: 2 }],
  } });
  if (error) throw error;
  rentalB = rid;
  const { data: iid, error: e2 } = await ownerB.client.rpc("create_invoice_from_rental", { p_rental: rentalB });
  if (e2) throw e2;
  invoiceB = iid;
  await ownerB.client.rpc("issue_invoice", { p_invoice: invoiceB });
  await ownerB.client.rpc("log_whatsapp_handoff", { p: { tenant_id: tenantB, invoice_id: invoiceB, purpose: "invoice", to_phone: "+923001234567", body: "hi" } });
  await admin.from("messaging_credentials").insert({ tenant_id: tenantB, access_token_encrypted: "x", token_last4: "1234" });
});

describe("tenant isolation: reads", () => {
  it("Tenant B owner sees their own data (sanity check)", async () => {
    for (const t of ["rentals", "rental_items", "invoices", "payments", "message_logs", "scheduled_reminders"]) {
      const { data, error } = await ownerB.client.from(t).select("tenant_id").eq("tenant_id", tenantB);
      expect(error, t).toBeNull();
      expect(data!.length, `${t} should have rows for B`).toBeGreaterThan(0);
    }
  });

  for (const who of ["ownerA", "staffA"] as const) {
    it(`${who} cannot read any Tenant B rows from tables or views`, async () => {
      const u = who === "ownerA" ? ownerA : staffA;
      for (const t of [...TENANT_TABLES, ...VIEWS]) {
        const { data, error } = await u.client.from(t).select("*").eq("tenant_id", tenantB);
        expect(error, t).toBeNull();
        expect(data, `${t} leaked Tenant B rows`).toEqual([]);
      }
      const { data: tenants } = await u.client.from("tenants").select("id");
      expect(tenants!.map((x) => x.id)).toEqual([tenantA]);
      // Unfiltered reads only ever return Tenant A rows.
      for (const t of TENANT_TABLES) {
        const { data } = await u.client.from(t).select("tenant_id");
        expect(data!.every((r: { tenant_id: string }) => r.tenant_id === tenantA), t).toBe(true);
      }
    });
  }

  it("profiles of Tenant B users are not visible to Tenant A", async () => {
    const { data } = await ownerA.client.from("user_profiles").select("id").eq("id", ownerB.id);
    expect(data).toEqual([]);
  });

  it("nobody can read messaging credentials through the API", async () => {
    const { data: d1, error: e1 } = await ownerB.client.from("messaging_credentials").select("*");
    expect(e1 !== null || (d1 ?? []).length === 0).toBe(true);
  });

  it("anonymous requests see nothing", async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    for (const t of ["tenants", ...TENANT_TABLES]) {
      const { data, error } = await anon.from(t).select("*").limit(1);
      expect(error !== null || (data ?? []).length === 0, t).toBe(true);
    }
    const { error } = await anon.rpc("quote_rental", { p: { tenant_id: tenantB } });
    expect(error).not.toBeNull();
  });
});

describe("tenant isolation: writes", () => {
  it("cannot insert rows into Tenant B", async () => {
    const attempts: [string, Record<string, unknown>][] = [
      ["clients", { tenant_id: tenantB, name: "Injected" }],
      ["equipment_items", { tenant_id: tenantB, name: "Injected", tracking: "bulk" }],
      ["equipment_categories", { tenant_id: tenantB, name: "Injected" }],
      ["suppliers", { tenant_id: tenantB, name: "Injected" }],
      ["shift_rules", { tenant_id: tenantB, name: "X", start_time: "01:00", end_time: "02:00" }],
      ["rentals", { tenant_id: tenantB, reference: "X", client_id: b.client.id }],
      ["invoices", { tenant_id: tenantB, number: "X", client_id: b.client.id, due_date: "2030-01-01" }],
      ["payments", { tenant_id: tenantB, invoice_id: invoiceB, amount: 1 }],
      ["message_logs", { tenant_id: tenantB, mode: "manual", status: "sent", purpose: "x" }],
      ["tenant_memberships", { tenant_id: tenantB, user_id: ownerA.id, role: "owner" }],
    ];
    for (const [t, row] of attempts) {
      const { error } = await ownerA.client.from(t).insert(row);
      expect(error, `${t} insert should fail`).not.toBeNull();
    }
    const { count } = await admin.from("clients").select("*", { count: "exact", head: true }).eq("tenant_id", tenantB).eq("name", "Injected");
    expect(count).toBe(0);
  });

  it("cannot update or delete Tenant B rows", async () => {
    const targets: [string, string, Record<string, unknown>][] = [
      ["clients", b.client.id, { name: "Hacked" }],
      ["equipment_items", b.cam.id, { name: "Hacked" }],
      ["shift_rules", b.shiftA.id, { name: "Hacked" }],
      ["tenant_settings", tenantB, { company_name: "Hacked" }],
      ["rentals", rentalB, { total: 0 }],
      ["invoices", invoiceB, { total: 0 }],
    ];
    for (const [t, id, patch] of targets) {
      const key = t === "tenant_settings" ? "tenant_id" : "id";
      const { data } = await ownerA.client.from(t).update(patch).eq(key, id).select();
      expect(data ?? [], `${t} update`).toEqual([]);
      await ownerA.client.from(t).delete().eq(key, id);
    }
    const { data: c } = await admin.from("clients").select("name").eq("id", b.client.id).single();
    expect(c!.name).toBe("Northlight Films");
    const { data: s } = await admin.from("tenant_settings").select("company_name").eq("tenant_id", tenantB).single();
    expect(s!.company_name).toBe("Bravo Rentals");
    const { data: inv } = await admin.from("invoices").select("total").eq("id", invoiceB).single();
    expect(Number(inv!.total)).toBeGreaterThan(0);
  });

  it("cannot move own rows into Tenant B or reference Tenant B records", async () => {
    const { data: own } = await ownerA.client.from("clients").select("id").eq("tenant_id", tenantA).limit(1).single();
    const { error: e1 } = await ownerA.client.from("clients").update({ tenant_id: tenantB }).eq("id", own!.id);
    expect(e1).not.toBeNull();
    // Composite foreign keys prevent pointing at another tenant's category.
    const { data: catB } = await admin.from("equipment_categories").select("id").eq("tenant_id", tenantB).limit(1).single();
    const { error: e2 } = await ownerA.client.from("equipment_items").insert({ tenant_id: tenantA, name: "X", category_id: catB!.id });
    expect(e2).not.toBeNull();
  });

  it("RPC functions reject Tenant B ids", async () => {
    const calls: [string, Record<string, unknown>][] = [
      ["quote_rental", { p: { tenant_id: tenantB, rental_type: "full_day", units: 1, items: [] } }],
      ["create_rental", { p: { tenant_id: tenantB, client_id: b.client.id, rental_type: "full_day", units: 1, items: [{ item_id: b.grip.id, quantity: 1 }] } }],
      // Tenant A id with Tenant B client/items must also fail.
      ["create_rental", { p: { tenant_id: tenantA, client_id: b.client.id, rental_type: "full_day", units: 1, items: [{ item_id: b.grip.id, quantity: 1 }] } }],
      ["dispatch_rental", { p_rental: rentalB }],
      ["record_return", { p: { rental_id: rentalB, lines: [] } }],
      ["extend_rental", { p_rental: rentalB, p_additional_units: 1 }],
      ["cancel_rental", { p_rental: rentalB }],
      ["add_rental_charge", { p_rental: rentalB, p_kind: "other", p_description: "x", p_amount: 5 }],
      ["create_invoice_from_rental", { p_rental: rentalB }],
      ["create_invoice", { p: { tenant_id: tenantA, client_id: b.client.id, items: [] } }],
      ["issue_invoice", { p_invoice: invoiceB }],
      ["void_invoice", { p_invoice: invoiceB, p_reason: "x" }],
      ["record_payment", { p_invoice: invoiceB, p_amount: 1 }],
      ["log_whatsapp_handoff", { p: { tenant_id: tenantB, purpose: "x", body: "x" } }],
      ["log_whatsapp_handoff", { p: { tenant_id: tenantA, invoice_id: invoiceB, purpose: "x", body: "x" } }],
      ["set_reminders_paused", { p_tenant: tenantB, p_paused: true }],
      ["provision_tenant", { p_name: "Evil", p_slug: "evil-co", p_owner: ownerA.id }],
      ["claim_due_reminders", { p_limit: 10, p_tenant: tenantB }],
    ];
    for (const [fn, args] of calls) {
      const { error } = await ownerA.client.rpc(fn, args);
      expect(error, `${fn} should be rejected`).not.toBeNull();
    }
    const { data: pays } = await admin.from("payments").select("amount").eq("invoice_id", invoiceB);
    expect(pays!.length).toBe(1); // only the deposit
    const { data: r } = await admin.from("rentals").select("status").eq("id", rentalB).single();
    expect(r!.status).toBe("dispatched");
  });
});

describe("tenant isolation: file storage", () => {
  it("files are only accessible inside their own tenant folder", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    const pathB = `${tenantB}/logo-test.png`;
    const up = await ownerB.client.storage.from("tenant-files").upload(pathB, png, { contentType: "image/png" });
    expect(up.error).toBeNull();

    const dl = await ownerA.client.storage.from("tenant-files").download(pathB);
    expect(dl.error).not.toBeNull();
    const signed = await ownerA.client.storage.from("tenant-files").createSignedUrl(pathB, 60);
    expect(signed.error).not.toBeNull();
    const intrude = await ownerA.client.storage.from("tenant-files").upload(`${tenantB}/evil.png`, png, { contentType: "image/png" });
    expect(intrude.error).not.toBeNull();
    const del = await ownerA.client.storage.from("tenant-files").remove([pathB]);
    expect(del.data ?? []).toEqual([]);
    const still = await ownerB.client.storage.from("tenant-files").download(pathB);
    expect(still.error).toBeNull();
    // Staff of the same tenant can read but not upload.
    const staffUp = await staffA.client.storage.from("tenant-files").upload(`${tenantA}/staff.png`, png, { contentType: "image/png" });
    expect(staffUp.error).not.toBeNull();
  });
});

describe("suspension and roles", () => {
  it("a suspended tenant loses access", async () => {
    const extra = await makeUser("ownerC");
    const tenantC = await makeTenant("Charlie Rentals", extra);
    const before = await extra.client.from("tenant_settings").select("tenant_id").eq("tenant_id", tenantC);
    expect(before.data!.length).toBe(1);
    await admin.from("tenants").update({ status: "suspended" }).eq("id", tenantC);
    const after = await extra.client.from("tenant_settings").select("tenant_id").eq("tenant_id", tenantC);
    expect(after.data).toEqual([]);
  });

  it("users cannot change their own membership role", async () => {
    const { data } = await staffA.client.from("tenant_memberships").update({ role: "owner" }).eq("user_id", staffA.id).select();
    expect(data ?? []).toEqual([]);
    const { data: m } = await admin.from("tenant_memberships").select("role").eq("user_id", staffA.id).single();
    expect(m!.role).toBe("staff");
  });
});
