import Link from "next/link";
import { requireTenant } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { SettingsTabs } from "./tabs";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant();
  return (
    <>
      <PageHeader title="Workspace settings" subtitle={`${ctx.settings.company_name} · you are ${ctx.role === "owner" ? "the owner" : `a ${ctx.role}`}`}
        actions={<Link href="/account" className="btn-ghost">My account</Link>} />
      <SettingsTabs />
      <div className="mt-6">{children}</div>
    </>
  );
}
