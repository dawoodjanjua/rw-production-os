import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "manager" | "staff";
const RANK: Record<Role, number> = { owner: 3, manager: 2, staff: 1 };
export const TENANT_COOKIE = "rw_tenant";

export function roleAtLeast(role: Role, min: Role) {
  return RANK[role] >= RANK[min];
}

export type Settings = {
  tenant_id: string; company_name: string; tagline: string | null; logo_path: string | null; brand_color: string;
  phone: string | null; whatsapp: string | null; email: string | null; address: string | null; website: string | null;
  ntn: string | null; currency: string; timezone: string; invoice_prefix: string; rental_prefix: string;
  invoice_footer: string | null; payment_instructions: string | null; payment_terms_days: number; tax_rate: number;
  grace_minutes: number; late_fee_mode: "none" | "per_unit_per_hour" | "day_rate_per_day"; late_fee_amount: number;
  reminders_enabled: boolean; reminders_paused: boolean; quiet_hours_start: string | null; quiet_hours_end: string | null;
  max_reminders_per_rental: number;
};

export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

export const getMemberships = cache(async () => {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, tenants!inner(id, name, slug, status)")
    .eq("user_id", user.id)
    .eq("active", true);
  return (data ?? [])
    .map((m) => ({ tenantId: m.tenant_id as string, role: m.role as Role, tenant: m.tenants as unknown as { id: string; name: string; slug: string; status: string } }))
    .filter((m) => m.tenant.status === "active");
});

export const isPlatformAdmin = cache(async () => {
  const user = await getUser();
  if (!user) return false;
  const supabase = await createClient();
  const { data } = await supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  return !!data;
});

/**
 * Resolve the active workspace for this request. The tenant id in the cookie is only a preference:
 * it is accepted only if the signed-in user has an active membership in that tenant.
 */
export const getTenantContext = cache(async () => {
  const user = await getUser();
  if (!user) redirect("/login");
  const memberships = await getMemberships();
  if (memberships.length === 0) return null;
  const preferred = (await cookies()).get(TENANT_COOKIE)?.value;
  const m = memberships.find((x) => x.tenantId === preferred) ?? memberships[0];
  const supabase = await createClient();
  const { data: settings } = await supabase.from("tenant_settings").select("*").eq("tenant_id", m.tenantId).single();
  return { user, supabase, tenantId: m.tenantId, role: m.role, tenant: m.tenant, settings: settings as Settings, memberships };
});

export type TenantContext = NonNullable<Awaited<ReturnType<typeof getTenantContext>>>;

/** For pages and server actions: require a workspace and a minimum role. */
export async function requireTenant(min: Role = "staff"): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx) redirect((await isPlatformAdmin()) ? "/admin" : "/no-workspace");
  if (!roleAtLeast(ctx.role, min)) throw new Error("You do not have permission to perform this action.");
  return ctx;
}

export async function requirePlatformAdmin() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (!(await isPlatformAdmin())) redirect("/dashboard");
  return user;
}

/** For pages: like requireTenant, but sends users without the role to a friendly "no access" page. */
export async function requirePageRole(min: Role): Promise<TenantContext> {
  const ctx = await requireTenant("staff");
  if (!roleAtLeast(ctx.role, min)) redirect("/forbidden");
  return ctx;
}
