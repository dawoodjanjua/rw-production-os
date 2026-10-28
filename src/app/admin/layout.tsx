import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";

export const metadata = { title: "Platform admin" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-[#0d1310] text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/admin" className="text-sm font-semibold">RW Production OS · Platform admin</Link>
          <div className="flex items-center gap-4 text-xs text-white/70"><span>{user.email}</span><Link href="/dashboard" className="hover:text-white">Workspace</Link>
            <form action="/auth/signout" method="post"><button className="hover:text-white">Sign out</button></form></div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
