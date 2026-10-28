import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/nav";
import { TENANT_COOKIE, getMemberships, isPlatformAdmin, requireTenant } from "@/lib/auth";
import { logoUrl } from "@/lib/branding";

async function switchWorkspace(fd: FormData) {
  "use server";
  const id = String(fd.get("tenant") ?? "");
  const memberships = await getMemberships();
  if (!memberships.some((m) => m.tenantId === id)) return; // only switch to a workspace you belong to
  (await cookies()).set(TENANT_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant();
  const [admin, logo] = await Promise.all([isPlatformAdmin(), logoUrl(ctx.supabase, ctx.settings.logo_path)]);
  return (
    <div style={{ ["--brand" as string]: ctx.settings.brand_color }} className="min-h-screen">
      <Sidebar
        brand={{ company: ctx.settings.company_name, logoUrl: logo, tagline: ctx.settings.tagline }}
        isAdmin={admin} userEmail={ctx.user.email ?? ""} role={ctx.role}
        workspaces={ctx.memberships.map((m) => ({ id: m.tenantId, name: m.tenant.name }))}
        activeTenant={ctx.tenantId} switchAction={switchWorkspace}
      />
      <main className="pb-24 lg:pb-10 lg:pl-60">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
