import Link from "next/link";
import { redirect } from "next/navigation";
import { getMemberships, getUser, isPlatformAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NoWorkspace() {
  const user = await getUser();
  if (!user) redirect("/login");
  // Shown only when the user truly has no active workspace; otherwise go straight in.
  if ((await getMemberships()).length > 0) redirect("/dashboard");
  const admin = await isPlatformAdmin();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card max-w-md p-6 text-center">
        <h1 className="text-base font-semibold">No active workspace</h1>
        <p className="mt-2 text-sm text-muted">
          {user.email} is not a member of an active company workspace. Ask your company owner to add you, or contact the platform administrator.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {admin && <Link href="/admin" className="btn-primary">Open platform admin</Link>}
          <form action="/auth/signout" method="post"><button className="btn-secondary">Sign out</button></form>
        </div>
      </div>
    </main>
  );
}
