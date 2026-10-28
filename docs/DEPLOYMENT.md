# Deployment guide — Supabase + Hostinger Business

Target: a **new subdomain** (e.g. `app.yourdomain.com`) so your existing website and email are untouched.
Do not change your root domain or MX/email DNS records for this.

Total time: about 45–60 minutes the first time.

---

## 1. Create the production database (Supabase)

1. Go to https://supabase.com → **New project**. Region: closest to Pakistan (e.g. *Singapore* or *Mumbai*).
   Choose a strong database password and store it in your password manager.
2. Wait for the project to finish provisioning.
3. **Apply the migrations** from your computer (one-time; needs Node.js):
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npx supabase db push
   ```
   `db push` applies everything in `supabase/migrations/` in order. Use the same command for future migrations.
   Never run `npm run seed:dev` against production (the script refuses non-local URLs anyway).
4. **Authentication settings** (Dashboard → Authentication):
   - *Sign In / Providers → Email*: keep enabled. **Turn OFF "Allow new users to sign up"**. Accounts are created only by
     the platform admin and company owners.
   - *URL Configuration*: Site URL = `https://app.yourdomain.com`; Redirect URLs: add `https://app.yourdomain.com/**`.
   - *Emails → SMTP Settings*: add your own SMTP (e.g. your Hostinger mailbox: `smtp.hostinger.com`, port 465). Without
     custom SMTP, Supabase only sends emails to your own team addresses, so the "Forgot password" email will not reach
     customers. The app's one-time setup links work without SMTP.
5. **Storage**: the migration creates the private `tenant-files` bucket. Check it exists under Storage, and leave it private.
6. Copy from *Project Settings → API*: Project URL, `anon` public key, `service_role` key (secret).

## 2. Generate app secrets

On any computer:
```bash
openssl rand -hex 32      # → CRON_SECRET
openssl rand -base64 32   # → MESSAGING_ENCRYPTION_KEY (keep a backup copy)
```

## 3. Deploy on Hostinger (Node.js Web App)

Hostinger Business Web Hosting supports Node.js web apps (Next.js preset). Confirm it in hPanel; one Hostinger page lists
only Cloud plans.

1. Push this project to a **private** GitHub repository. `.env*` files are git-ignored; only `.env.example` is committed.
2. hPanel → **Websites → Add website → Node.js Web App → Import Git repository** → *Connect with GitHub* → pick the repo
   and branch `main`.
3. Build settings:
   - Framework: **Next.js**
   - Node version: **20.x or 22.x**
   - Install: `npm ci` · Build: `npm run build` · Start: `npm start` (Hostinger provides `PORT`; `next start` uses it)
4. **Environment variables**: add every variable from `.env.example` with production values **before the first
   build**. `NEXT_PUBLIC_*` values are baked in at build time. You can upload a `.env` file in that screen.
   Keep `WHATSAPP_SEND_ENABLED=false` for now.
5. **Domain**: attach the subdomain `app.yourdomain.com` to the app (hPanel guides you). If your DNS is at Hostinger this
   adds only a record for the subdomain. Enable **SSL** (free Let's Encrypt) for it.
6. Deploy. Each push to `main` redeploys automatically.

### Verify the deployment
- `https://app.yourdomain.com/login` shows the sign-in page over HTTPS.
- `https://app.yourdomain.com/api/cron/reminders` returns `{"error":"unauthorized"}` (401). That is correct.

## 4. Create the platform admin and the first tenant

From your computer, with production values in a separate file (e.g. `.env.production.local`, never committed):
```bash
ENV_FILE=.env.production.local npm run admin:create -- you@yourcompany.com "Your Name"
```
Open the printed link (valid 1 hour) → choose a password → you land in `/admin`.

In **/admin → Create workspace**: enter the company name, plan, and the owner's name and email. You get a one-time setup
link. Send it to the owner (e.g. on WhatsApp). They choose their own password; no shared or default passwords exist.
The owner then adds staff from **Settings → Team**, which also produces one-time links.

## 5. Reminder scheduler (required for automatic reminders)

Hostinger Business has no always-on background worker, so an external scheduler calls the app every few minutes:

```
GET https://app.yourdomain.com/api/cron/reminders
Header: Authorization: Bearer <CRON_SECRET>
```
The endpoint is idempotent and safe to call concurrently. Each call processes due jobs and returns a JSON summary.

**Option A — cron-job.org (free, simplest):** create a cronjob with the URL above, schedule *every 5 minutes*, and under
*Advanced → Headers* add `Authorization: Bearer <CRON_SECRET>`. Enable failure notifications.

**Option B — Hostinger cron (hPanel → Advanced → Cron Jobs):** custom command, every 5 minutes:
```
curl -fsS -H "Authorization: Bearer <CRON_SECRET>" https://app.yourdomain.com/api/cron/reminders > /dev/null
```

**Option C — Supabase pg_cron + pg_net** (Database → Extensions → enable both), then in the SQL editor:
```sql
select cron.schedule('rw-reminders', '*/5 * * * *', $$
  select net.http_get(url := 'https://app.yourdomain.com/api/cron/reminders',
                      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'))
$$);
```

Until WhatsApp is connected (see `docs/WHATSAPP.md`), processed reminders are recorded as **Dry run (not sent)** with
the exact message text, so staff can send them manually from the Reminders page.

## 6. Backups and recovery

- Supabase **Pro** plan includes daily backups (7 days) and optional point-in-time recovery; the Free plan has **no
  downloadable backups**. For real customer data use Pro, or run a nightly logical backup yourself:
  ```bash
  npx supabase db dump --linked -f backup-$(date +%F).sql          # schema
  npx supabase db dump --linked --data-only -f data-$(date +%F).sql
  ```
  Store backups off-site (e.g. Google Drive). Logos in Storage are small; re-uploadable if lost.
- **Restore test:** at least once, restore a dump into a new Supabase project (`psql "<connection string>" -f file.sql`)
  and sign in, so you know the procedure works.
- Keep `MESSAGING_ENCRYPTION_KEY` safe; without it, encrypted WhatsApp tokens must be re-entered.

## 7. Pre-launch checklist

- [ ] Migrations applied (`npx supabase db push` shows no pending changes)
- [ ] Public sign-ups disabled; redirect URLs set; SMTP configured
- [ ] All env vars set in Hostinger; `SUPABASE_SERVICE_ROLE_KEY` present only there
- [ ] HTTPS works on the subdomain; main site and email unaffected
- [ ] Platform admin created via `admin:create`; first tenant created via `/admin`
- [ ] No demo data in production (`seed:dev` never run against it)
- [ ] Scheduler calling `/api/cron/reminders` returns `"ok": true`
- [ ] Backups enabled and a restore tested
