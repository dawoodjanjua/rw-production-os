import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.local" });

export const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(URL)) {
  throw new Error("Integration tests only run against a local Supabase instance.");
}

export const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

export type TestUser = { id: string; email: string; client: SupabaseClient };

export async function makeUser(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@test.rw.local`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, email, client };
}

export async function makeTenant(name: string, owner: TestUser) {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 6)}`;
  const { data, error } = await admin.rpc("provision_tenant", { p_name: name, p_slug: slug, p_owner: owner.id });
  if (error) throw error;
  return data as string;
}

export async function addMember(tenantId: string, user: TestUser, role: "owner" | "manager" | "staff") {
  const { error } = await admin.from("tenant_memberships").insert({ tenant_id: tenantId, user_id: user.id, role });
  if (error) throw error;
}

/** Build a small tenant with a client, a serialized camera (2 assets) and a bulk item (qty 4). */
export async function buildInventory(owner: TestUser, tenantId: string) {
  const c = owner.client;
  const { data: cats } = await c.from("equipment_categories").select("id,name").eq("tenant_id", tenantId);
  const camCat = cats!.find((x) => x.name === "Camera")!.id;
  const gripCat = cats!.find((x) => x.name === "Grip")!.id;
  const { data: cam, error: e1 } = await c.from("equipment_items").insert({
    tenant_id: tenantId, name: "Sony FX3", code: "CAM", category_id: camCat, tracking: "serialized",
    shift_rate: 12000, day_rate: 20000, quantity_total: 0,
  }).select().single();
  if (e1) throw e1;
  const { error: e2 } = await c.from("equipment_assets").insert([
    { tenant_id: tenantId, item_id: cam.id, asset_code: "CAM-001", serial_number: "S1" },
    { tenant_id: tenantId, item_id: cam.id, asset_code: "CAM-002", serial_number: "S2" },
  ]);
  if (e2) throw e2;
  const { data: grip, error: e3 } = await c.from("equipment_items").insert({
    tenant_id: tenantId, name: "C-stand", code: "GRP-006", category_id: gripCat, tracking: "bulk",
    quantity_total: 4, shift_rate: 1500, day_rate: 2500,
  }).select().single();
  if (e3) throw e3;
  const { data: client, error: e4 } = await c.from("clients").insert({
    tenant_id: tenantId, name: "Northlight Films", whatsapp: "+923001234567",
  }).select().single();
  if (e4) throw e4;
  const { data: shifts } = await c.from("shift_rules").select("*").eq("tenant_id", tenantId).order("sort_order");
  return { cam, grip, client, shiftA: shifts![0], shiftB: shifts![1] };
}
