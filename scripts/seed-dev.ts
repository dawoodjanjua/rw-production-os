/**
 * DEVELOPMENT-ONLY demo data. Refuses to run against anything except a local Supabase instance.
 * Creates a fictional rental company with an owner, a manager and staff (random passwords printed once),
 * inventory, clients and rentals in reserved / dispatched / overdue / partially returned / returned states,
 * plus invoices and payments — all through the same database functions the app uses.
 *
 *   npm run seed:dev
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, service = process.env.SUPABASE_SERVICE_ROLE_KEY!, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  console.error(`Refusing to seed ${url}: demo data is for local development only.`);
  process.exit(1);
}
const admin = createClient(url, service, { auth: { persistSession: false } });
const H = 3600_000, D = 24 * H;

async function user(email: string, name: string) {
  const password = randomBytes(12).toString("base64url");
  const { data: found } = await admin.from("user_profiles").select("id").eq("email", email).maybeSingle();
  if (found) await admin.auth.admin.deleteUser(found.id);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error) throw error;
  await admin.from("user_profiles").update({ full_name: name }).eq("id", data.user.id);
  const client = createClient(url, anon, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password });
  return { id: data.user.id, email, password, client };
}

async function rpc(c: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

async function main() {
  await admin.from("tenants").delete().eq("slug", "kite-production-rentals");
  const owner = await user("owner@kite.demo", "Ayesha Khan");
  const manager = await user("manager@kite.demo", "Bilal Ahmed");
  const staff = await user("staff@kite.demo", "Usman Ali");
  const platform = await user("admin@platform.demo", "Platform Admin");
  await admin.from("platform_admins").upsert({ user_id: platform.id });

  const tenant = await rpc(admin, "provision_tenant", { p_name: "Kite Production Rentals", p_slug: "kite-production-rentals", p_owner: owner.id, p_plan: "professional" });
  await admin.from("tenant_memberships").insert([{ tenant_id: tenant, user_id: manager.id, role: "manager" }, { tenant_id: tenant, user_id: staff.id, role: "staff" }]);
  const c = owner.client;
  await c.from("tenant_settings").update({
    tagline: "Production · Creative · Equipment", phone: "+924235761234", whatsapp: "+923001112233", email: "rentals@kite.demo",
    address: "Plot 12, Gulberg III\nLahore, Pakistan", invoice_prefix: "KPR",
    payment_instructions: "Bank: Meezan Bank · Title: Kite Production Rentals · IBAN: PK00 MEZN 0000 0000 0000 0000 (demo)",
    invoice_footer: "Thank you for renting with Kite Production Rentals.", grace_minutes: 30,
  }).eq("tenant_id", tenant);

  const { data: cats } = await c.from("equipment_categories").select("id,name").eq("tenant_id", tenant);
  const cat = (n: string) => cats!.find((x) => x.name === n)!.id;
  const item = async (row: Record<string, unknown>, assets: [string, string][] = []) => {
    const { data, error } = await c.from("equipment_items").insert({ tenant_id: tenant, ...row }).select().single();
    if (error) throw error;
    if (assets.length) await c.from("equipment_assets").insert(assets.map(([code, sn]) => ({ tenant_id: tenant, item_id: data.id, asset_code: code, serial_number: sn })));
    return data;
  };
  const fx3 = await item({ name: "Sony FX3 Cinema Camera", code: "CAM-FX3", category_id: cat("Camera"), tracking: "serialized", shift_rate: 12000, day_rate: 20000, purchase_cost: 1250000, replacement_value: 1400000, accessories: "2× NP-FZ100 batteries, charger, cage, top handle, 2× 128GB CFexpress A" }, [["CAM-001", "FX3-5510231"], ["CAM-002", "FX3-5510488"]]);
  const fx6 = await item({ name: "Sony FX6 Cinema Camera", code: "CAM-FX6", category_id: cat("Camera"), tracking: "serialized", shift_rate: 18000, day_rate: 30000, is_kit: true, accessories: "Kit: body, LCD, handle, 4× BP-U70, V-mount plate" }, [["CAM-003", "FX6-7100021"]]);
  const lens = await item({ name: "Sony FE 24–70mm f/2.8 GM II", code: "LEN-2470", category_id: cat("Lens"), tracking: "serialized", shift_rate: 4000, day_rate: 6500 }, [["LEN-004", "2470-188201"], ["LEN-005", "2470-188455"]]);
  const prime = await item({ name: "Sigma Cine Prime Set (5 lenses)", code: "LEN-SIG", category_id: cat("Lens"), tracking: "serialized", is_kit: true, shift_rate: 15000, day_rate: 25000, accessories: "18, 24, 35, 50, 85mm T1.5 in hard case" }, [["LEN-SET1", "SIG-SET-01"]]);
  const aputure = await item({ name: "Aputure LS 600d Pro", code: "LGT-600", category_id: cat("Lighting"), tracking: "serialized", shift_rate: 6000, day_rate: 9000 }, [["LGT-001", "AP600-1101"], ["LGT-002", "AP600-1102"]]);
  const tube = await item({ name: "Nanlite PavoTube II 30X", code: "LGT-TUBE", category_id: cat("Lighting"), tracking: "bulk", quantity_total: 8, shift_rate: 1500, day_rate: 2500 });
  const cstand = await item({ name: "C-Stand with grip arm", code: "GRP-006", category_id: cat("Grip"), tracking: "bulk", quantity_total: 12, shift_rate: 500, day_rate: 800, qty_maintenance: 1 });
  const sandbag = await item({ name: "Sandbag 10kg", code: "GRP-SB", category_id: cat("Grip"), tracking: "bulk", quantity_total: 20, shift_rate: 100, day_rate: 150 });
  const mic = await item({ name: "Sennheiser MKH 416 Shotgun", code: "AUD-416", category_id: cat("Audio"), tracking: "bulk", quantity_total: 3, shift_rate: 2500, day_rate: 4000 });
  await item({ name: "V-mount battery 150Wh", code: "ACC-VM", category_id: cat("Accessories"), tracking: "bulk", quantity_total: 10, shift_rate: 600, day_rate: 1000 });

  const client = async (name: string, contact: string, wa: string) => (await c.from("clients").insert({ tenant_id: tenant, name, contact_person: contact, whatsapp: wa, phone: wa }).select().single()).data!;
  const northlight = await client("Northlight Films", "Hamza Siddiqui", "+923211234567");
  const frame = await client("Frame Studio", "Sana Malik", "+923331234567");
  const kiteMedia = await client("Blue Kite Media", "Omar Farooq", "+923451234567");
  await client("Lahore Ad Works", "Zara Hussain", "+923001239876");
  await c.from("suppliers").insert({ tenant_id: tenant, name: "Cine Gear Imports", contact_person: "Faisal", whatsapp: "+923009998877" });

  const { data: shifts } = await c.from("shift_rules").select("id").eq("tenant_id", tenant).order("sort_order");
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
  // Asia/Karachi is UTC+5 with no DST: wall-clock HH:MM on (today + dayOffset).
  const pkt = (dayOffset: number, hhmm: string) => {
    const d = new Date(Date.parse(today + "T00:00:00Z") + dayOffset * D).toISOString().slice(0, 10);
    return { date: d, iso: new Date(`${d}T${hhmm}:00+05:00`).toISOString() };
  };
  // Shift B (17:00–23:00) dispatched at 17:30: today if that has passed, otherwise yesterday (then it is overdue too).
  const shiftB = Date.now() > Date.parse(pkt(0, "17:30").iso) ? pkt(0, "17:30") : pkt(-1, "17:30");
  const shiftA15 = pkt(-15, "11:00");

  // 1. Dispatched today on Shift B (due tonight) — Northlight
  const r1 = await rpc(staff.client, "create_rental", { p: { tenant_id: tenant, client_id: northlight.id, project_name: "Brand film shoot", location: "DHA Phase 6, Lahore", responsible_name: "Hamza Siddiqui", responsible_whatsapp: "+923211234567",
    rental_type: "shift", shift_rule_id: shifts![1].id, shift_date: shiftB.date, units: 1, start_at: shiftB.iso, dispatch_now: true, deposit_amount: 5000,
    items: [{ item_id: fx3.id, quantity: 1 }, { item_id: lens.id, quantity: 1 }, { item_id: cstand.id, quantity: 4 }], dispatch_condition: "All checked, sensor clean" } });
  // 2. Overdue custom rental — Frame Studio
  const r2 = await rpc(manager.client, "create_rental", { p: { tenant_id: tenant, client_id: frame.id, project_name: "Music video", rental_type: "custom", start_at: iso(now - 2 * D), custom_return_at: iso(now - 3 * H), dispatch_now: true,
    items: [{ item_id: aputure.id, quantity: 1 }, { item_id: tube.id, quantity: 4 }, { item_id: sandbag.id, quantity: 6 }] } });
  // 3. Full-day rental, 3 days, partially returned — Blue Kite Media
  const r3 = await rpc(manager.client, "create_rental", { p: { tenant_id: tenant, client_id: kiteMedia.id, project_name: "Documentary series", rental_type: "full_day", units: 3, start_at: iso(now - 1 * D), dispatch_now: true, discount_amount: 2000,
    items: [{ item_id: fx6.id, quantity: 1 }, { item_id: prime.id, quantity: 1 }, { item_id: mic.id, quantity: 2 }] } });
  const { data: r3lines } = await c.from("rental_items").select("id,item_id").eq("rental_id", r3);
  await rpc(staff.client, "record_return", { p: { rental_id: r3, returned_at: iso(now - 1 * H), lines: [{ rental_item_id: r3lines!.find((l) => l.item_id === mic.id)!.id, returned: 2, condition: "OK" }] } });
  // 4. Reservation for tomorrow — Northlight
  await rpc(manager.client, "create_rental", { p: { tenant_id: tenant, client_id: northlight.id, project_name: "TVC — Day 2", rental_type: "full_day", units: 1, start_at: iso(now + 20 * H), dispatch_now: false,
    items: [{ item_id: lens.id, quantity: 1 }, { item_id: tube.id, quantity: 2 }] } });
  // 5. Returned last week, invoiced and partly paid — Frame Studio
  const r5 = await rpc(manager.client, "create_rental", { p: { tenant_id: tenant, client_id: frame.id, project_name: "Product shoot", rental_type: "full_day", units: 2, start_at: iso(now - 8 * D), dispatch_now: true, deposit_amount: 10000,
    items: [{ item_id: fx3.id, quantity: 1 }, { item_id: aputure.id, quantity: 1 }, { item_id: cstand.id, quantity: 2 }] } });
  const { data: r5lines } = await c.from("rental_items").select("id,quantity").eq("rental_id", r5);
  await rpc(staff.client, "record_return", { p: { rental_id: r5, returned_at: iso(now - 6 * D + 2 * H), lines: r5lines!.map((l) => ({ rental_item_id: l.id, returned: l.quantity, condition: "Good" })) } });
  const inv5 = await rpc(manager.client, "create_invoice_from_rental", { p_rental: r5 });
  await rpc(manager.client, "issue_invoice", { p_invoice: inv5 });
  await rpc(manager.client, "record_payment", { p_invoice: inv5, p_amount: 20000, p_method: "bank_transfer", p_reference: "IBFT-48211", p_paid_at: iso(now - 3 * D) });
  // 6. Older rental, fully paid and closed — Blue Kite Media
  const r6 = await rpc(manager.client, "create_rental", { p: { tenant_id: tenant, client_id: kiteMedia.id, project_name: "Corporate interview", rental_type: "shift", shift_rule_id: shifts![0].id, shift_date: shiftA15.date, units: 1, start_at: shiftA15.iso, dispatch_now: true,
    items: [{ item_id: fx3.id, quantity: 1 }, { item_id: mic.id, quantity: 1 }] } });
  const { data: r6lines } = await c.from("rental_items").select("id,quantity").eq("rental_id", r6);
  await rpc(staff.client, "record_return", { p: { rental_id: r6, returned_at: iso(Date.parse(shiftA15.iso) + 6 * H), lines: r6lines!.map((l) => ({ rental_item_id: l.id, returned: l.quantity })) } });
  const inv6 = await rpc(manager.client, "create_invoice_from_rental", { p_rental: r6 });
  await rpc(manager.client, "issue_invoice", { p_invoice: inv6 });
  const { data: i6 } = await c.from("invoices").select("total").eq("id", inv6).single();
  await rpc(manager.client, "record_payment", { p_invoice: inv6, p_amount: i6!.total, p_method: "cash", p_paid_at: iso(Date.parse(shiftA15.iso) + D) });
  await rpc(manager.client, "close_rental", { p_rental: r6 });
  // 7. Manual invoice (draft) for crew services
  await rpc(manager.client, "create_invoice", { p: { tenant_id: tenant, client_id: northlight.id, project_name: "Brand film shoot", items: [{ description: "Gaffer + 2 assistants — production shift", quantity: 1, unit_price: 35000 }, { description: "Transport (Lahore)", quantity: 1, unit_price: 6000 }] } });

  console.log("\nDemo workspace: Kite Production Rentals (LOCAL DEVELOPMENT ONLY)\n");
  for (const u of [owner, manager, staff, platform]) console.log(`  ${u.email.padEnd(22)} ${u.password}`);
  console.log(`\n  Rentals: ${[r1, r2, r3].length} out (1 overdue, 1 partly returned), 1 reserved, 2 returned. Open http://localhost:3000\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
