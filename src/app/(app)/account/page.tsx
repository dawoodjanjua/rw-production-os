import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { str, type ActionState } from "@/lib/actions";

async function saveProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  "use server";
  const ctx = await requireTenant();
  const { error } = await ctx.supabase.from("user_profiles").update({ full_name: str(fd, "full_name") }).eq("id", ctx.user.id);
  if (error) return { error: error.message };
  revalidatePath("/account");
  return { ok: "Saved." };
}

async function changePassword(_: ActionState, fd: FormData): Promise<ActionState> {
  "use server";
  const ctx = await requireTenant();
  const pw = str(fd, "password");
  if (pw.length < 10) return { error: "Use at least 10 characters." };
  if (pw !== str(fd, "confirm")) return { error: "Passwords do not match." };
  const { error } = await ctx.supabase.auth.updateUser({ password: pw });
  if (error) return { error: error.message };
  return { ok: "Password changed." };
}

export default async function AccountPage() {
  const ctx = await requireTenant();
  const { data: p } = await ctx.supabase.from("user_profiles").select("full_name,email").eq("id", ctx.user.id).single();
  return (
    <div className="max-w-xl space-y-6">
      <PageHeader title="My account" subtitle={p?.email} />
      <Card title="Profile"><ActionForm action={saveProfile} className="space-y-3"><label className="block"><span className="label">Full name</span><input name="full_name" defaultValue={p?.full_name ?? ""} className="input" /></label><SubmitButton>Save</SubmitButton></ActionForm></Card>
      <Card title="Change password"><ActionForm action={changePassword} resetOnSuccess className="space-y-3">
        <input name="password" type="password" minLength={10} required placeholder="New password" autoComplete="new-password" className="input" />
        <input name="confirm" type="password" minLength={10} required placeholder="Confirm new password" autoComplete="new-password" className="input" />
        <SubmitButton>Change password</SubmitButton></ActionForm></Card>
    </div>
  );
}
