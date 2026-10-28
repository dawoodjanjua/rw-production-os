import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { getUser } from "@/lib/auth";
import { setPassword } from "../actions";

export const metadata = { title: "Set password" };

export default async function SetPasswordPage() {
  const user = await getUser();
  if (!user) redirect("/login?error=" + encodeURIComponent("Your link is invalid or has expired."));
  return (
    <>
      <h1 className="mb-1 text-base font-semibold">Choose a password</h1>
      <p className="mb-4 text-sm text-muted">For {user.email}. Use at least 10 characters.</p>
      <ActionForm action={setPassword} className="space-y-3">
        <label className="block"><span className="label">New password</span><input name="password" type="password" minLength={10} required autoComplete="new-password" className="input" /></label>
        <label className="block"><span className="label">Confirm password</span><input name="confirm" type="password" minLength={10} required autoComplete="new-password" className="input" /></label>
        <SubmitButton className="btn-primary w-full">Save password</SubmitButton>
      </ActionForm>
    </>
  );
}
