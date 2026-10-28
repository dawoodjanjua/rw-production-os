export type ActionState = { error?: string; ok?: string } | undefined;

/** Turn database / validation errors into short user-facing messages. */
export function friendlyError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/duplicate key value.*code/i.test(msg)) return "That code is already used by another item.";
  if (/duplicate key value.*asset_code/i.test(msg)) return "That asset code already exists.";
  if (/duplicate key value/i.test(msg)) return "A record with these details already exists.";
  if (/violates row-level security|permission denied/i.test(msg)) return "You do not have permission to perform this action.";
  if (/violates foreign key/i.test(msg)) return "This record is linked to other records and cannot be changed this way.";
  if (/check constraint/i.test(msg)) return "Some values are not valid. Please check the form.";
  return msg.replace(/^.*?ERROR:\s*/, "");
}

export function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
export function optStr(fd: FormData, key: string) {
  return str(fd, key) || null;
}
export function optNum(fd: FormData, key: string) {
  const v = str(fd, key).replace(/,/g, "");
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid number for ${key.replace(/_/g, " ")}`);
  return n;
}
