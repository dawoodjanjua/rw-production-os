import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  return v;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  serviceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  siteUrl: () => (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, ""),
  cronSecret: () => process.env.CRON_SECRET || "",
  /** Real WhatsApp API sends happen only when this is exactly "true" AND the tenant connection is live. */
  whatsappSendEnabled: () => process.env.WHATSAPP_SEND_ENABLED === "true",
  whatsappAppSecret: () => process.env.WHATSAPP_APP_SECRET || "",
  whatsappVerifyToken: () => process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "",
  whatsappApiVersion: () => process.env.WHATSAPP_API_VERSION || "v23.0",
  encryptionKey: () => process.env.MESSAGING_ENCRYPTION_KEY || "",
};
