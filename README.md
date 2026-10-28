# RW Production OS

Multi-tenant equipment rental and production operations app for rental houses. Each company gets an isolated, branded
workspace covering inventory, dispatches and returns, shift/day billing, invoices, payments, and WhatsApp reminders.

**Stack:** Next.js 15 (App Router, TypeScript, Tailwind 4) · Supabase Auth + Postgres + Storage · Row Level Security ·
server-side PDF (`@react-pdf/renderer`) · database-backed reminder jobs called by an external scheduler.

## Run locally

Requirements: Node 20.9+ and Docker.

```bash
npm install
npx supabase start          # local Postgres/Auth/Storage; applies migrations
cp .env.example .env.local  # fill with the values printed by `npx supabase status`
npm run seed:dev            # OPTIONAL demo company; prints one-time random passwords
npm run dev                 # http://localhost:3000
```

Create a platform admin without demo data: `npm run admin:create -- you@example.com "Your Name"`
(it prints a one-time link for choosing a password).

## Tests

```bash
npm run test:unit   # phone/WhatsApp/timezone helpers
npm test            # everything incl. tenant isolation, workflow and reminder tests (needs `npx supabase start`)
npm run typecheck && npm run lint && npm run build
```

`tests/isolation.test.ts` proves Tenant A cannot read, insert, update or delete Tenant B data through tables, views,
RPC functions or storage. `tests/workflow.test.ts` covers pricing, deadlines (incl. midnight and DST), availability,
partial returns, late fees, invoices, payments, roles. `tests/reminders.test.ts` covers the reminder processor.

## Documentation

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Supabase + Hostinger deployment, first tenant, scheduler, backups
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — design decisions, schema, security model, changelog
- [docs/WHATSAPP.md](docs/WHATSAPP.md) — manual handoff and connecting the official WhatsApp Business Platform

## Project layout

```
supabase/migrations/   schema, RLS policies, transactional functions (source of truth for business rules)
src/app/(auth)/        login, password reset, set password
src/app/(app)/         tenant workspace: dashboard, equipment, rentals, returns, invoices, clients, suppliers,
                       reports, reminders, settings, account
src/app/admin/         platform admin console (tenants, plans, WhatsApp credentials)
src/app/api/           invoice PDF, reminder cron endpoint, WhatsApp webhook
src/lib/               auth/tenant context, Supabase clients, formatting, messaging (provider boundary, processor)
scripts/               bootstrap-admin (production-safe), seed-dev (local only)
tests/                 vitest suites
```
