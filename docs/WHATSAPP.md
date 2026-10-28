# WhatsApp messaging

## Phase 1 — manual handoff (works now, no API needed)

"Open WhatsApp" on rentals, invoices and dry-run reminders opens `wa.me/<number>?text=<prepared message>`. The user
reviews the message, presses **Send in WhatsApp**, and attaches the invoice PDF (download it first). The app logs this
as **"WhatsApp opened (not confirmed)"**. It is never recorded as sent or delivered.

## Phase 2 — official WhatsApp Business Platform (Cloud API)

Code is in place, but **sending only happens when all of these are true**:
1. `WHATSAPP_SEND_ENABLED=true` on the server,
2. the tenant has a stored connection (phone number ID + encrypted access token),
3. the tenant's sending mode is **Test** (sends only to their test number) or **Live**,
4. an approved template name is configured for that reminder type.

Otherwise reminders run as dry runs. Each tenant pays Meta directly for its own messages.

### Connecting a tenant (per company)
1. The company creates a Meta Business account and a WhatsApp Business Account (WABA) in WhatsApp Manager, registers a
   phone number that is not used in the WhatsApp app, and adds a payment method.
2. Create **utility** templates (Category: Utility), e.g. `return_reminder` with body
   `Hi {{1}}, a reminder from {{2}}: rental {{3}} ({{4}}) is due back at {{5}}.` and wait for approval.
   The app fills parameters in the order `client, company, reference, items, due` unless another order is entered
   (available keys: client, company, reference, items, due, company_phone, project).
3. Create a **System User** in Business Settings with access to the WABA and generate a permanent token with
   `whatsapp_business_messaging` and `whatsapp_business_management` permissions.
4. Platform admin → `/admin` → tenant → **WhatsApp Business connection**: enter Phone number ID, WABA ID, display number
   and the token. The token is encrypted with AES-256-GCM (`MESSAGING_ENCRYPTION_KEY`) in a table no user can read, and
   it is never shown again.
5. Company owner → **Settings → WhatsApp**: enter template names, a test recipient (their own number), mode **Test**.
   Process a reminder and confirm it arrives. Then switch to **Live**.

### Delivery status webhook
In the Meta app (WhatsApp → Configuration → Webhook): Callback URL `https://app.yourdomain.com/api/webhooks/whatsapp`,
Verify token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; subscribe to `messages`. Set `WHATSAPP_APP_SECRET` so signatures are
verified. Status moves `queued → sent → delivered → read` (never downgraded), or `failed` with the error.

### Safety features
Jobs are claimed with `FOR UPDATE SKIP LOCKED`; a queued/sent log for a job blocks any resend; the rental status and
deadline are re-checked right before sending; quiet hours defer jobs; there is a per-rental maximum; managers can pause;
transient errors (HTTP 5xx/429) retry up to 3 times with backoff.

### Later improvement
Replace step 4 with Meta **Embedded Signup** (requires your own Meta app approved as a Tech Provider), so owners connect
their number themselves. The provider boundary (`src/lib/messaging/provider.ts`) stays the same.
