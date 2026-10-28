import { requireTenant } from "@/lib/auth";
import { env } from "@/lib/env";
import { DEFAULT_PARAMS } from "@/lib/messaging/reminders";
import { Badge, Card, Notice } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { saveMessaging } from "../actions";

export const metadata = { title: "WhatsApp" };
const KINDS = [["before_due", "Upcoming return"], ["at_due", "Return due"], ["overdue", "Overdue"], ["dispatch_confirmation", "Dispatch confirmation"], ["return_confirmation", "Return confirmation"]];

export default async function MessagingSettings() {
  const ctx = await requireTenant();
  const { data: conn } = await ctx.supabase.from("messaging_connections").select("*").eq("tenant_id", ctx.tenantId).maybeSingle();
  const owner = ctx.role === "owner";
  const connected = !!conn?.phone_number_id;
  const templates = (conn?.templates ?? {}) as Record<string, { name: string; language: string; params: string[] }>;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card title="Manual WhatsApp (always available)">
          <p className="text-sm text-muted">On rentals, invoices and reminders, <b>Open WhatsApp</b> opens the client&apos;s chat with a prepared message. You press Send in WhatsApp and attach the PDF yourself. The app records this as &quot;WhatsApp opened&quot;, never as delivered. No API account is needed.</p>
        </Card>
        <Card title="Automatic messages — official WhatsApp Business Platform" actions={<Badge tone={conn?.status === "live" ? "green" : conn?.status === "test" ? "amber" : "gray"}>{conn?.status === "live" ? "Live" : conn?.status === "test" ? "Test mode" : conn?.status === "disabled" ? "Disabled" : "Not connected"}</Badge>}>
          <div className="space-y-3 text-sm">
            {!env.whatsappSendEnabled() && <Notice tone="warn">Server-side sending is switched off (WHATSAPP_SEND_ENABLED is not &quot;true&quot;). All automatic reminders run as dry runs and are NOT sent.</Notice>}
            {connected ? <p>Connected number: <b>{conn!.display_phone_number ?? conn!.phone_number_id}</b> · WABA {conn!.waba_id ?? "—"}</p>
              : <Notice tone="info">No WhatsApp Business account is connected to this workspace. Automatic reminders stay in dry-run mode until the platform administrator connects your account (see steps on the right). Meta charges messaging fees to your own WhatsApp Business account; they are not included in your subscription.</Notice>}
          </div>
          <ActionForm action={saveMessaging} className="mt-4">
            <fieldset disabled={!owner} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label><span className="label">Sending mode</span>
                  <select name="mode" defaultValue={conn?.status === "live" || conn?.status === "test" ? conn.status : "disabled"} className="input">
                    <option value="disabled">Off (dry run only)</option>
                    <option value="test" disabled={!connected}>Test — send only to test number</option>
                    <option value="live" disabled={!connected}>Live — send to clients</option>
                  </select></label>
                <label><span className="label">Test recipient (your own WhatsApp)</span><input name="test_recipient" defaultValue={conn?.test_recipient ?? ""} className="input" placeholder="0300 1234567" /></label>
              </div>
              <div>
                <div className="label">Approved utility templates</div>
                <p className="mb-2 text-xs text-muted">Enter the exact template names approved in WhatsApp Manager. Parameters are filled in order; default order: {DEFAULT_PARAMS.join(", ")}.</p>
                <div className="space-y-2">
                  {KINDS.map(([k, l]) => (
                    <div key={k} className="grid grid-cols-1 gap-2 sm:grid-cols-[150px_1fr_70px_1fr]">
                      <span className="self-center text-sm">{l}</span>
                      <input name={`${k}_tpl`} defaultValue={templates[k]?.name ?? ""} placeholder="template_name" className="input" />
                      <input name={`${k}_lang`} defaultValue={templates[k]?.language ?? "en"} className="input" aria-label="Language" />
                      <input name={`${k}_params`} defaultValue={templates[k]?.params?.join(", ") ?? ""} placeholder={DEFAULT_PARAMS.join(", ")} className="input" aria-label="Parameters" />
                    </div>
                  ))}
                </div>
              </div>
              {owner && <SubmitButton>Save WhatsApp settings</SubmitButton>}
            </fieldset>
          </ActionForm>
        </Card>
      </div>
      <Card title="How to connect">
        <ol className="list-decimal space-y-2 pl-4 text-sm text-muted">
          <li>Create or use a Meta Business account and a WhatsApp Business Account (WABA) with a phone number not used in the WhatsApp app.</li>
          <li>Add a payment method in WhatsApp Manager — Meta bills your business directly for messages.</li>
          <li>Create and get approval for <b>utility</b> templates for return reminders.</li>
          <li>Ask the platform administrator to connect the number. Access tokens are entered once, encrypted on the server, and never shown again.</li>
          <li>Use <b>Test</b> mode with your own number first, then switch to <b>Live</b>.</li>
        </ol>
      </Card>
    </div>
  );
}
