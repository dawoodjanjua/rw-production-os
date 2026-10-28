-- RW Production OS · Reminders and WhatsApp messaging
-- Reminder jobs are durable rows. An external scheduler calls /api/cron/reminders, which claims due jobs,
-- re-checks the rental, and either sends through the official API (when connected) or records a dry run.
-- Message states are honest: 'opened' (manual handoff) is never reported as sent or delivered.

create type public.reminder_kind as enum ('before_due', 'at_due', 'overdue', 'dispatch_confirmation', 'return_confirmation');
create type public.reminder_status as enum ('scheduled', 'processing', 'sent', 'dry_run', 'skipped', 'cancelled', 'failed');
create type public.message_status as enum ('prepared', 'opened', 'queued', 'sent', 'delivered', 'read', 'failed', 'cancelled', 'dry_run');
create type public.messaging_status as enum ('not_connected', 'test', 'live', 'disabled', 'error');

create table public.reminder_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind public.reminder_kind not null,
  offset_minutes int not null default 0 check (offset_minutes between 0 and 10080),
  enabled boolean not null default true,
  template text not null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind)
);
create trigger reminder_rules_touch before update on public.reminder_rules for each row execute function app.touch_updated_at();
create trigger reminder_rules_tenant before update on public.reminder_rules for each row execute function app.prevent_tenant_change();

create table public.scheduled_reminders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rental_id uuid not null,
  kind public.reminder_kind not null,
  due_at timestamptz not null,
  deadline_at timestamptz,             -- rental deadline this reminder was computed from
  status public.reminder_status not null default 'scheduled',
  attempts int not null default 0,
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  cancel_reason text,
  message_log_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rental_id, kind, due_at),
  foreign key (tenant_id, rental_id) references public.rentals(tenant_id, id) on delete cascade
);
create index scheduled_reminders_due_idx on public.scheduled_reminders(status, due_at);
create index scheduled_reminders_tenant_idx on public.scheduled_reminders(tenant_id, due_at desc);
create trigger scheduled_reminders_touch before update on public.scheduled_reminders for each row execute function app.touch_updated_at();

-- Non-secret connection metadata, readable by members of the tenant.
create table public.messaging_connections (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  provider text not null default 'whatsapp_cloud',
  status public.messaging_status not null default 'not_connected',
  waba_id text,
  phone_number_id text,
  display_phone_number text,
  templates jsonb not null default '{}'::jsonb,   -- { "<reminder_kind>": { "name": "...", "language": "en" } }
  test_recipient text check (test_recipient is null or test_recipient ~ '^\+[1-9][0-9]{6,14}$'),
  last_error text,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);
create trigger messaging_connections_touch before update on public.messaging_connections for each row execute function app.touch_updated_at();

-- Encrypted provider credentials. No policies: never readable through the Data API; server (service role) only.
create table public.messaging_credentials (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  access_token_encrypted text not null,
  token_last4 text,
  updated_at timestamptz not null default now()
);

create table public.message_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel text not null default 'whatsapp',
  mode text not null check (mode in ('manual', 'dry_run', 'api', 'api_test')),
  status public.message_status not null,
  purpose text not null,
  to_phone text,
  body text,
  template_name text,
  template_params jsonb,
  rental_id uuid,
  invoice_id uuid,
  client_id uuid,
  reminder_id uuid,
  provider_message_id text,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  foreign key (tenant_id, rental_id) references public.rentals(tenant_id, id) on delete set null (rental_id),
  foreign key (tenant_id, invoice_id) references public.invoices(tenant_id, id) on delete set null (invoice_id),
  foreign key (tenant_id, client_id) references public.clients(tenant_id, id) on delete set null (client_id)
);
create unique index message_logs_provider_uniq on public.message_logs(provider_message_id) where provider_message_id is not null;
create index message_logs_tenant_idx on public.message_logs(tenant_id, created_at desc);
create index message_logs_rental_idx on public.message_logs(tenant_id, rental_id);
create trigger message_logs_touch before update on public.message_logs for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------
create or replace function app.cancel_rental_reminders(p_rental uuid, p_reason text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.scheduled_reminders set status = 'cancelled', cancel_reason = p_reason
   where rental_id = p_rental and status = 'scheduled'
$$;

create or replace function app.schedule_confirmation(p_rental uuid, p_kind public.reminder_kind) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rentals; s public.tenant_settings;
begin
  select * into r from public.rentals where id = p_rental;
  select * into s from public.tenant_settings where tenant_id = r.tenant_id;
  if not s.reminders_enabled then return; end if;
  insert into public.scheduled_reminders (tenant_id, rental_id, kind, due_at, deadline_at)
  select r.tenant_id, r.id, rr.kind, now() + make_interval(mins => rr.offset_minutes), r.expected_return_at
    from public.reminder_rules rr where rr.tenant_id = r.tenant_id and rr.kind = p_kind and rr.enabled
  on conflict (rental_id, kind, due_at) do nothing;
end $$;

-- (Re)build the return reminders of a rental from the tenant's rules. Idempotent.
create or replace function app.schedule_rental_reminders(p_rental uuid, p_with_dispatch_confirmation boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rentals; s public.tenant_settings; rr public.reminder_rules; v_due timestamptz;
begin
  select * into r from public.rentals where id = p_rental;
  select * into s from public.tenant_settings where tenant_id = r.tenant_id;
  update public.scheduled_reminders set status = 'cancelled', cancel_reason = 'Rescheduled'
   where rental_id = p_rental and status = 'scheduled' and kind in ('before_due', 'at_due', 'overdue');
  if r.status not in ('dispatched', 'partially_returned') or not s.reminders_enabled then return; end if;

  for rr in select * from public.reminder_rules where tenant_id = r.tenant_id and enabled
            and kind in ('before_due', 'at_due', 'overdue') loop
    v_due := case rr.kind
      when 'before_due' then r.expected_return_at - make_interval(mins => rr.offset_minutes)
      when 'at_due' then r.expected_return_at
      else r.expected_return_at + make_interval(mins => rr.offset_minutes) end;
    if v_due < now() - interval '1 minute' then continue; end if;   -- never backfill past reminders
    insert into public.scheduled_reminders (tenant_id, rental_id, kind, due_at, deadline_at)
    values (r.tenant_id, r.id, rr.kind, v_due, r.expected_return_at)
    on conflict (rental_id, kind, due_at) do update
      set status = 'scheduled', cancel_reason = null, deadline_at = excluded.deadline_at
      where scheduled_reminders.status = 'cancelled';
  end loop;

  if p_with_dispatch_confirmation then
    perform app.schedule_confirmation(p_rental, 'dispatch_confirmation');
  end if;
end $$;

-- Claim due reminder jobs for processing (service role only). SKIP LOCKED makes concurrent runs safe;
-- jobs stuck in 'processing' for 10 minutes are retried.
create or replace function public.claim_due_reminders(p_limit int default 50, p_tenant uuid default null)
returns setof public.scheduled_reminders
language sql security definer set search_path = public, pg_temp as $$
  update public.scheduled_reminders s set status = 'processing', locked_at = now(), attempts = s.attempts + 1
  where s.id in (
    select id from public.scheduled_reminders
     where ((status = 'scheduled' and due_at <= now())
            or (status = 'processing' and locked_at < now() - interval '10 minutes'))
       and (p_tenant is null or tenant_id = p_tenant)
     order by due_at
     limit p_limit
     for update skip locked)
  returning s.*
$$;

-- Manual WhatsApp handoff: the user opened WhatsApp with a prepared message. This is NOT a delivery.
create or replace function public.log_whatsapp_handoff(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_tenant uuid := (p->>'tenant_id')::uuid; v_id uuid;
begin
  perform app.require_role(v_tenant, 'staff');
  if nullif(p->>'rental_id','') is not null and not exists (select 1 from public.rentals where id = (p->>'rental_id')::uuid and tenant_id = v_tenant) then
    raise exception 'Rental not found'; end if;
  if nullif(p->>'invoice_id','') is not null and not exists (select 1 from public.invoices where id = (p->>'invoice_id')::uuid and tenant_id = v_tenant) then
    raise exception 'Invoice not found'; end if;
  if nullif(p->>'client_id','') is not null and not exists (select 1 from public.clients where id = (p->>'client_id')::uuid and tenant_id = v_tenant) then
    raise exception 'Client not found'; end if;
  insert into public.message_logs (tenant_id, mode, status, purpose, to_phone, body, rental_id, invoice_id, client_id, reminder_id, created_by)
  values (v_tenant, 'manual', 'opened', coalesce(nullif(p->>'purpose',''), 'message'), p->>'to_phone', left(p->>'body', 4000),
    nullif(p->>'rental_id','')::uuid, nullif(p->>'invoice_id','')::uuid, nullif(p->>'client_id','')::uuid,
    (select id from public.scheduled_reminders where id = nullif(p->>'reminder_id','')::uuid and tenant_id = v_tenant),
    auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Managers can pause/resume automated reminders without owner-level settings access.
create or replace function public.set_reminders_paused(p_tenant uuid, p_paused boolean) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_role(p_tenant, 'manager');
  update public.tenant_settings set reminders_paused = p_paused where tenant_id = p_tenant;
end $$;

-- ---------------------------------------------------------------------------
-- Tenant provisioning (service role only — called by the platform admin console)
-- ---------------------------------------------------------------------------
create or replace function public.provision_tenant(p_name text, p_slug text, p_owner uuid, p_plan public.tenant_plan default 'starter')
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid;
begin
  insert into public.tenants (name, slug, plan) values (trim(p_name), lower(trim(p_slug)), p_plan) returning id into v_id;
  insert into public.tenant_settings (tenant_id, company_name, invoice_prefix, payment_instructions, invoice_footer)
  values (v_id, trim(p_name),
          coalesce(nullif(upper(regexp_replace(left(p_slug, 3), '[^a-zA-Z0-9]', '', 'g')), ''), 'INV'),
          'Please pay by bank transfer and share the receipt on WhatsApp.',
          'Thank you for your business.');
  insert into public.tenant_memberships (tenant_id, user_id, role) values (v_id, p_owner, 'owner');
  insert into public.messaging_connections (tenant_id) values (v_id);
  -- Editable sample settings, not fixed rules.
  insert into public.shift_rules (tenant_id, name, start_time, end_time, sort_order) values
    (v_id, 'Shift A', '11:00', '17:00', 1),
    (v_id, 'Shift B', '17:00', '23:00', 2);
  insert into public.equipment_categories (tenant_id, name) values
    (v_id, 'Camera'), (v_id, 'Lens'), (v_id, 'Lighting'), (v_id, 'Grip'), (v_id, 'Audio'), (v_id, 'Accessories');
  insert into public.reminder_rules (tenant_id, kind, offset_minutes, enabled, template) values
    (v_id, 'before_due', 60, true, 'Hi {client}, a reminder from {company}: rental {reference} ({items}) is due back at {due}. Questions? Call {company_phone}.'),
    (v_id, 'at_due', 0, true, 'Hi {client}, rental {reference} from {company} is due back now ({due}). Please arrange the return. {company_phone}'),
    (v_id, 'overdue', 30, true, 'Hi {client}, rental {reference} from {company} was due at {due} and is now overdue. Please return the equipment or contact us at {company_phone}.'),
    (v_id, 'dispatch_confirmation', 0, false, 'Hi {client}, {company} has dispatched rental {reference}: {items}. Return by {due}.'),
    (v_id, 'return_confirmation', 0, false, 'Hi {client}, {company} has received the equipment for rental {reference}. Thank you!');
  return v_id;
end $$;
