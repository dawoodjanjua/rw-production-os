import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Short-lived signed URL for a tenant's logo. Storage RLS ensures only members can sign it. */
export async function logoUrl(supabase: SupabaseClient, path: string | null | undefined, seconds = 3600) {
  if (!path) return null;
  const { data } = await supabase.storage.from("tenant-files").createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}
