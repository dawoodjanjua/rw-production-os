import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

function key() {
  const k = Buffer.from(env.encryptionKey(), "base64");
  if (k.length !== 32) throw new Error("MESSAGING_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
  return k;
}

/** AES-256-GCM. Output: base64(iv).base64(tag).base64(ciphertext) */
export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(payload: string) {
  const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
