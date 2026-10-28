"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { str, type ActionState } from "@/lib/actions";

export async function signIn(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: str(fd, "email"), password: str(fd, "password") });
  if (error) return { error: "Incorrect email or password." };
  const next = str(fd, "next");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function requestReset(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = str(fd, "email");
  if (!email) return { error: "Enter your email address." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${env.siteUrl()}/auth/confirm?next=/set-password` });
  // Same response whether or not the account exists.
  return { ok: "If an account exists for this email, a reset link has been sent." };
}

export async function setPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const password = str(fd, "password");
  if (password.length < 10) return { error: "Use at least 10 characters." };
  if (password !== str(fd, "confirm")) return { error: "Passwords do not match." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your link has expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/dashboard");
}
