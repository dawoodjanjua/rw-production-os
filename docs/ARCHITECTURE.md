# Architecture & decisions

## Key decisions
| Decision | Why |
|---|---|
| One Next.js codebase, many tenants (`tenant_id` on every business row) | Required multi-tenant SaaS; no per-customer deploys |
| Supabase Auth + Postgres RLS as the isolation boundary | Isolation is enforced in the database, so a UI or server bug cannot leak data across tenants |
| Composite foreign keys `(tenant_id, id)` | A row can only reference rows of its own tenant (e.g. a rental can't use another tenant's client) |
| Ledger writes only through `SECURITY DEFINER` SQL functions | Dispatch, return, extension, invoice and payment are single transactions with row locks, explicit role checks and server-side pricing. Users have SELECT-only grants on these tables |
| Pricing/deadline logic in SQL (`quote_rental`) used for both preview and save | One source of truth; the client cannot submit its own prices |
| Snapshots: rate per line, shift/terms JSON on rental, company/client JSON on issued invoice | Changing prices or settings never alters history |
| Overdue is derived (`v_rentals.is_overdue`, `v_invoices.is_overdue`) | No background job needed to flip statuses; always accurate |
| Reminders = durable rows + external scheduler hitting `/api/cron/reminders` | Hostinger Business has no permanent worker; the endpoint is idempotent |
| PDF via `@react-pdf/renderer` on demand | Pure JS (no Chromium) so it runs on shared Node hosting; generated with the user's RLS client, so other tenants' invoices return 404 |
| No public sign-up; one-time setup links | No default/shared passwords; links work without SMTP |
| Platform admins manage tenants but cannot read tenant business data | Least privilege; admin console uses the service role only for provisioning |

## Roles
- **Platform admin** (`platform_admins`): `/admin` — create tenants and owners, plan, suspend, WhatsApp credentials.
- **Owner**: everything in the tenant, plus settings, shifts, reminder rules, team, voiding invoices, deleting payments.
- **Manager**: equipment, categories, clients, suppliers, rentals incl. rate overrides, discounts, extensions, charges,
  cancellations, invoices and payments; can pause reminders.
- **Staff**: create rentals/dispatches at standard rates, record returns, add clients, open WhatsApp handoffs.
Suspended tenants and deactivated memberships lose all access immediately (checked in `app.tenant_role`).

## Schema (supabase/migrations)
`tenants, platform_admins, user_profiles, tenant_memberships, tenant_settings, tenant_counters, audit_logs,
shift_rules, equipment_categories (default rates), equipment_items, equipment_assets, suppliers, clients, projects,
rentals, rental_items, rental_charges, rental_events (dispatch/return/extension/deadline audit trail),
invoices, invoice_items, payments, reminder_rules, scheduled_reminders, messaging_connections,
messaging_credentials (encrypted, no API access), message_logs`
Views (security_invoker): `v_equipment_availability, v_rentals, v_invoices`.

The requested `rental_rates`, `dispatch_events` and `return_events` tables are covered by item/category rates plus a shift
multiplier, `rental_events`, and `rental_items` return quantities.

### Billing rules
- **Shift:** due at the shift end on day `shift_date + units − 1` (an overnight shift ends the next day). Rate = item
  (or category) shift rate × shift multiplier.
- **Full day:** due `units` × 24h of local wall-clock time after dispatch (DST-safe). Rate = day rate.
- **Custom:** user deadline; billed per started 24h at the day rate.
- **Late fee:** only if configured (`per_unit_per_hour` or `day_rate_per_day`), after the grace period, counted from
  the deadline, added as a visible `rental_charges` row that managers can waive.
- **Availability:** serialized assets have a status; bulk = total − maintenance − damaged − missing − units held by
  reserved or out rentals. Reservations hold stock until dispatched or cancelled. Item rows are locked during dispatch.

## Changelog
- **2026-10-28 — v0.1 pilot.** Initial schema (7 migrations), RLS, transactional rental/invoice functions, Next.js app,
  PDF, manual WhatsApp handoff, dry-run reminder processor, Cloud API boundary and webhook, admin console, tests.
  Fixes found in testing: `created_by` FKs set to `ON DELETE SET NULL`; the audit trigger skips cascaded tenant deletes.
- **2026-10-30.** Migration `20261030000001_shift_date_auto.sql`: when no shift date is chosen, a shift rental uses the
  next shift that has not ended (an evening dispatch for an 11 AM–5 PM shift → tomorrow). The dispatch form shows the
  chosen date and can be overridden. Seed script and tests no longer depend on the time of day.
- **Environment variables added:** see `.env.example`.
