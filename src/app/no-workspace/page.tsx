import { getUser } from "@/lib/auth";

export default async function NoWorkspace() {
  const user = await getUser();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card max-w-md p-6 text-center">
        <h1 className="text-base font-semibold">No active workspace</h1>
        <p className="mt-2 text-sm text-muted">
          {user?.email} is not a member of an active company workspace. Ask your company owner to add you, or contact the platform administrator.
        </p>
        <form action="/auth/signout" method="post" className="mt-4"><button className="btn-secondary">Sign out</button></form>
      </div>
    </main>
  );
}
