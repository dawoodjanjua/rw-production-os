import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicOrigin } from "@/lib/public-url";

/** Verifies invite / recovery links (token_hash flow) and establishes the session server-side. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = publicOrigin(request);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/set-password";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/set-password";
  const supabase = await createClient();

  let error: unknown = null;
  if (tokenHash && type) {
    ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
  } else if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else {
    error = new Error("missing token");
  }
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("This link is invalid or has expired. Ask your administrator for a new one.")}`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
