"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth";
import { friendlyError, optNum, optStr, str, type ActionState } from "@/lib/actions";

const int = (fd: FormData, k: string) => {
  const n = optNum(fd, k) ?? 0;
  if (!Number.isInteger(n)) throw new Error(`${k.replace(/_/g, " ")} must be a whole number`);
  return n;
};

export async function saveItem(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = str(fd, "id");
  try {
    const ctx = await requireTenant("manager");
    const tracking = str(fd, "tracking") === "serialized" ? "serialized" : "bulk";
    const name = str(fd, "name");
    if (!name) return { error: "Name is required." };
    const row: Record<string, unknown> = {
      name, code: optStr(fd, "code"), description: optStr(fd, "description"),
      category_id: optStr(fd, "category_id"), supplier_id: optStr(fd, "supplier_id"),
      is_kit: fd.get("is_kit") === "on", accessories: optStr(fd, "accessories"),
      condition: str(fd, "condition") || "good", condition_notes: optStr(fd, "condition_notes"),
      shift_rate: optNum(fd, "shift_rate"), day_rate: optNum(fd, "day_rate"),
      purchase_cost: optNum(fd, "purchase_cost"), replacement_value: optNum(fd, "replacement_value"),
    };
    if (tracking === "bulk") {
      row.quantity_total = int(fd, "quantity_total");
      row.qty_maintenance = int(fd, "qty_maintenance");
      row.qty_damaged = int(fd, "qty_damaged");
      row.qty_missing = int(fd, "qty_missing");
      if ((row.quantity_total as number) < 1) return { error: "Quantity must be at least 1." };
    }
    if (id) {
      const { error } = await ctx.supabase.from("equipment_items").update(row).eq("id", id).eq("tenant_id", ctx.tenantId);
      if (error) return { error: friendlyError(error) };
    } else {
      const { data, error } = await ctx.supabase.from("equipment_items")
        .insert({ ...row, tenant_id: ctx.tenantId, tracking, quantity_total: tracking === "bulk" ? row.quantity_total : 0 })
        .select("id").single();
      if (error) return { error: friendlyError(error) };
      id = data.id;
      // Serialized items: create the first asset from the form, if given.
      const firstAsset = optStr(fd, "first_asset_code");
      if (tracking === "serialized" && firstAsset) {
        const { error: e2 } = await ctx.supabase.from("equipment_assets").insert({
          tenant_id: ctx.tenantId, item_id: id, asset_code: firstAsset, serial_number: optStr(fd, "first_serial"),
        });
        if (e2) return { error: `Item saved, but the asset could not be added: ${friendlyError(e2)}` };
      }
    }
  } catch (e) {
    return { error: friendlyError(e) };
  }
  revalidatePath("/equipment");
  redirect(`/equipment/${id}`);
}

export async function setArchived(fd: FormData) {
  const ctx = await requireTenant("manager");
  const id = str(fd, "id");
  await ctx.supabase.from("equipment_items").update({ archived_at: fd.get("archive") === "1" ? new Date().toISOString() : null })
    .eq("id", id).eq("tenant_id", ctx.tenantId);
  revalidatePath(`/equipment/${id}`);
  revalidatePath("/equipment");
}

export async function addAsset(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenant("manager");
    const itemId = str(fd, "item_id");
    const code = str(fd, "asset_code");
    if (!code) return { error: "Asset code is required." };
    const { error } = await ctx.supabase.from("equipment_assets").insert({
      tenant_id: ctx.tenantId, item_id: itemId, asset_code: code, serial_number: optStr(fd, "serial_number"),
      condition: str(fd, "condition") || "good", notes: optStr(fd, "notes"),
    });
    if (error) return { error: friendlyError(error) };
    revalidatePath(`/equipment/${itemId}`);
    return { ok: `Asset ${code} added.` };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function updateAsset(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireTenant("manager");
    const { error } = await ctx.supabase.from("equipment_assets").update({
      status: str(fd, "status"), condition: str(fd, "condition") || "good", notes: optStr(fd, "notes"),
      serial_number: optStr(fd, "serial_number"),
    }).eq("id", str(fd, "id")).eq("tenant_id", ctx.tenantId);
    if (error) return { error: friendlyError(error) };
    revalidatePath(`/equipment/${str(fd, "item_id")}`);
    return { ok: "Asset updated." };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
