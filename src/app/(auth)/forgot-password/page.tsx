import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { requestReset } from "../actions";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-base font-semibold">Reset your password</h1>
      <p className="mb-4 text-sm text-muted">We will email you a secure link to choose a new password.</p>
      <ActionForm action={requestReset} className="space-y-3">
        <label className="block"><span className="label">Email</span><input name="email" type="email" required className="input" /></label>
        <SubmitButton className="btn-primary w-full" pendingText="Sending…">Send reset link</SubmitButton>
      </ActionForm>
      <div className="mt-4 text-center text-sm"><Link href="/login" className="link">Back to sign in</Link></div>
    </>
  );
}
