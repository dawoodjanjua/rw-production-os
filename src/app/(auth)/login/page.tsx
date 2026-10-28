import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { signIn } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="mb-4 text-base font-semibold">Sign in to your workspace</h1>
      {error && <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p>}
      <ActionForm action={signIn} className="space-y-3">
        <input type="hidden" name="next" value={next ?? ""} />
        <label className="block"><span className="label">Email</span><input name="email" type="email" required autoComplete="email" className="input" /></label>
        <label className="block"><span className="label">Password</span><input name="password" type="password" required autoComplete="current-password" className="input" /></label>
        <SubmitButton className="btn-primary w-full" pendingText="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <div className="mt-4 text-center text-sm"><Link href="/forgot-password" className="link">Forgot password?</Link></div>
      <p className="mt-4 text-center text-xs text-muted">Accounts are created by your company owner. There is no public sign-up.</p>
    </>
  );
}
