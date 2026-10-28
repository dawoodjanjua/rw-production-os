"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { friendlyError, optStr, str, type ActionState } from "@/lib/actions";

/** Create or update a client or supplier. Phone/WhatsApp are validated and stored in E.164. */
export async function saveContact(_: ActionState, fd: FormData): Promise<ActionState> {
  const kind = str(fd, "kind") === "supplier" ? "suppliers" : "clients";
  let id = str(fd, "id");
  try {
    const ctx = await requireTenant(kind === "clients" && !id ? "staff" : "manager");
    const name = str(fd, "name");
    if (!name) return { error: "Name is required." };
    const email = optStr(fd, "email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Email address is not valid." };
    let phone: string | null, whatsapp: string | null;
    try {
      phone = normalizePhone(optStr(fd, "phone"));
      whatsapp = normalizePhone(optStr(fd, "whatsapp")) ?? phone;
    } catch (e) {
      return { error: (e as Error).message };
    }
    const row = { name, contact_person: optStr(fd, "contact_person"), phone, whatsapp, email, address: optStr(fd, "address"), notes: optStr(fd, "notes") };
    if (id) {
      const { error } = await ctx.supabase.from(kind).update(row).eq("id", id).eq("tenant_id", ctx.tenantId);
      if (error) return { error: friendlyError(error) };
    } else {
      const { data, error } = await ctx.supabase.from(kind).insert({ ...row, tenant_id: ctx.tenantId }).select("id").single();
      if (error) return { error: friendlyError(error) };
      id = data.id;
    }
  } catch (e) {
    return { error: friendlyError(e) };
  }
  revalidatePath(`/${kind}`);
  const back = str(fd, "return_to");
  redirect(back.startsWith("/") && !back.startsWith("//") ? back : `/${kind}/${id}`);
}

export async function archiveContact(fd: FormData) {
  const ctx = await requireTenant("manager");
  const kind = str(fd, "kind") === "supplier" ? "suppliers" : "clients";
  await ctx.supabase.from(kind).update({ archived_at: fd.get("archive") === "1" ? new Date().toISOString() : null })
    .eq("id", str(fd, "id")).eq("tenant_id", ctx.tenantId);
  revalidatePath(`/${kind}`);
  redirect(`/${kind}`);
}
