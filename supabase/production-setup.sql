-- RW Production OS — one-time production database setup.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Run it ONCE on a new, empty project.
-- It applies every migration in supabase/migrations and records them, so later `supabase db push` only adds new ones.
-- Generated from supabase/migrations; do not edit by hand.

-- ===== 20261028000001_core.sql =====
-- RW Production OS · Core: tenants, users, memberships, settings, helpers, audit
-- Every tenant-owned table carries tenant_id and is protected by RLS (see 20261028000006_rls.sql).

create extension if not exists pgcrypto;

-- Private schema for helper functions. Not exposed through the Data API.
create schema if not exists app;
grant usage on schema app to authenticated, service_role;

create type public.membership_role as enum ('owner', 'manager', 'staff');
create type public.tenant_plan as enum ('starter', 'professional', 'white_label');
create type public.tenant_status as enum ('active', 'suspended');

-- ---------------------------------------------------------------------------
-- Tenants & users
-- ---------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  plan public.tenant_plan not null default 'starter',
  status public.tenant_status not null default 'active',
  plan_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.membership_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index tenant_memberships_user_idx on public.tenant_memberships(user_id);

-- Keep a profile row for each auth user.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.user_profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER so they can read memberships under RLS)
-- ---------------------------------------------------------------------------
create or replace function app.role_rank(r public.membership_role) returns int
language sql immutable as $$
  select case r when 'owner' then 3 when 'manager' then 2 when 'staff' then 1 else 0 end
$$;

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- Current user's role in a tenant, or null. Suspended tenants and inactive memberships return null.
create or replace function app.tenant_role(p_tenant uuid) returns public.membership_role
language sql stable security definer set search_path = public, pg_temp as $$
  select m.role
  from public.tenant_memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.active and t.status = 'active'
$$;

create or replace function app.is_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.tenant_role(p_tenant) is not null
$$;

create or replace function app.has_min_role(p_tenant uuid, p_min public.membership_role) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.role_rank(app.tenant_role(p_tenant)) >= app.role_rank(p_min), false)
$$;

-- Raise unless the caller has at least p_min in p_tenant. Used by every RPC.
create or replace function app.require_role(p_tenant uuid, p_min public.membership_role) returns public.membership_role
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role public.membership_role;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  v_role := app.tenant_role(p_tenant);
  if v_role is null or app.role_rank(v_role) < app.role_rank(p_min) then
    raise exception 'You do not have permission to perform this action' using errcode = '42501';
  end if;
  return v_role;
end $$;

grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Settings & counters
-- ---------------------------------------------------------------------------
create type public.late_fee_mode as enum ('none', 'per_unit_per_hour', 'day_rate_per_day');

create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  company_name text not null,
  tagline text,
  logo_path text,
  brand_color text not null default '#1f4d3a' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  phone text,
  whatsapp text,
  email text,
  address text,
  website text,
  ntn text,
  currency text not null default 'PKR' check (currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'Asia/Karachi',
  invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z0-9]{1,8}$'),
  rental_prefix text not null default 'RNT' check (rental_prefix ~ '^[A-Z0-9]{1,8}$'),
  invoice_footer text,
  payment_instructions text,
  payment_terms_days int not null default 7 check (payment_terms_days between 0 and 365),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  grace_minutes int not null default 30 check (grace_minutes between 0 and 1440),
  late_fee_mode public.late_fee_mode not null default 'none',
  late_fee_amount numeric(12,2) not null default 0 check (late_fee_amount >= 0),
  reminders_enabled boolean not null default true,
  reminders_paused boolean not null default false,
  quiet_hours_start time default '23:00',
  quiet_hours_end time default '08:00',
  max_reminders_per_rental int not null default 5 check (max_reminders_per_rental between 0 and 50),
  updated_at timestamptz not null default now()
);

create or replace function app.validate_timezone() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone %', new.timezone;
  end if;
  return new;
end $$;
create trigger tenant_settings_tz before insert or update of timezone on public.tenant_settings
  for each row execute function app.validate_timezone();

create table public.tenant_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null,
  period text not null default '',
  value int not null default 0,
  primary key (tenant_id, kind, period)
);

create or replace function app.next_counter(p_tenant uuid, p_kind text, p_period text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v int;
begin
  insert into public.tenant_counters (tenant_id, kind, period, value) values (p_tenant, p_kind, p_period, 1)
  on conflict (tenant_id, kind, period) do update set value = tenant_counters.value + 1
  returning value into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Audit log (written by triggers and RPCs only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  data jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_tenant_idx on public.audit_logs(tenant_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs(tenant_id, entity, entity_id);

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_changes jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
    -- Whole-tenant deletion cascades: nothing to audit once the tenant itself is gone.
    if not exists (select 1 from public.tenants where id = (v_row->>'tenant_id')::uuid) then
      return old;
    end if;
  else
    v_row := to_jsonb(new);
  end if;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    select jsonb_object_agg(key, jsonb_build_object('from', v_old->key, 'to', value))
      into v_changes
      from jsonb_each(v_row)
      where v_old->key is distinct from value and key not in ('updated_at');
    if v_changes is null then return new; end if;
  end if;
  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, data)
  values ((v_row->>'tenant_id')::uuid, auth.uid(), lower(tg_op), tg_table_name,
          nullif(v_row->>'id','')::uuid,
          case when tg_op = 'UPDATE' then v_changes else v_row end);
  return coalesce(new, old);
end $$;

create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Tenant ownership of a row can never change.
create or replace function app.prevent_tenant_change() returns trigger language plpgsql as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot be changed';
  end if;
  return new;
end $$;

create trigger tenants_touch before update on public.tenants for each row execute function app.touch_updated_at();
create trigger user_profiles_touch before update on public.user_profiles for each row execute function app.touch_updated_at();
create trigger tenant_memberships_touch before update on public.tenant_memberships for each row execute function app.touch_updated_at();
create trigger tenant_memberships_tenant before update on public.tenant_memberships for each row execute function app.prevent_tenant_change();
create trigger tenant_settings_touch before update on public.tenant_settings for each row execute function app.touch_updated_at();
create trigger tenant_settings_audit after update on public.tenant_settings for each row execute function app.audit_row();
create trigger tenant_memberships_audit after insert or update or delete on public.tenant_memberships for each row execute function app.audit_row();

-- A tenant must always keep at least one active owner.
create or replace function app.keep_an_owner() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tenant uuid := coalesce(old.tenant_id, new.tenant_id);
begin
  if exists (select 1 from public.tenants where id = v_tenant)
     and not exists (select 1 from public.tenant_memberships
                     where tenant_id = v_tenant and role = 'owner' and active) then
    raise exception 'A company must keep at least one active owner';
  end if;
  return null;
end $$;
create constraint trigger tenant_memberships_owner after update or delete on public.tenant_memberships
  deferrable initially deferred for each row execute function app.keep_an_owner();

-- ===== 20261028000002_inventory.sql =====
-- RW Production OS · Inventory, clients, suppliers, projects, shifts
-- Composite foreign keys (tenant_id, id) guarantee rows can only reference rows of the same tenant.

create table public.shift_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  start_time time not null,
  end_time time not null check (end_time <> start_time),
  rate_multiplier numeric(6,3) not null default 1 check (rate_multiplier > 0 and rate_multiplier <= 10),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table public.equipment_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  default_shift_rate numeric(12,2) check (default_shift_rate >= 0),
  default_day_rate numeric(12,2) check (default_day_rate >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  contact_person text,
  phone text,
  whatsapp text check (whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
  email text,
  address text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index suppliers_tenant_idx on public.suppliers(tenant_id, name);

create type public.tracking_mode as enum ('serialized', 'bulk');
create type public.asset_status as enum ('available', 'reserved', 'dispatched', 'maintenance', 'damaged', 'missing', 'retired');

create table public.equipment_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid,
  supplier_id uuid,
  name text not null check (length(trim(name)) between 1 and 160),
  code text check (code is null or length(code) <= 40),
  description text,
  tracking public.tracking_mode not null default 'bulk',
  is_kit boolean not null default false,
  accessories text,
  -- Bulk items: total units owned. Serialized items: maintained from equipment_assets.
  quantity_total int not null default 1 check (quantity_total >= 0),
  -- Bulk items: units currently out of service (not available to rent).
  qty_maintenance int not null default 0 check (qty_maintenance >= 0),
  qty_damaged int not null default 0 check (qty_damaged >= 0),
  qty_missing int not null default 0 check (qty_missing >= 0),
  condition text not null default 'good',
  condition_notes text,
  shift_rate numeric(12,2) check (shift_rate >= 0),
  day_rate numeric(12,2) check (day_rate >= 0),
  purchase_cost numeric(14,2) check (purchase_cost >= 0),
  replacement_value numeric(14,2) check (replacement_value >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references public.equipment_categories(tenant_id, id),
  foreign key (tenant_id, supplier_id) references public.suppliers(tenant_id, id),
  check (qty_maintenance + qty_damaged + qty_missing <= quantity_total or tracking = 'serialized')
);
create unique index equipment_items_code_uniq on public.equipment_items(tenant_id, lower(code)) where code is not null;
create index equipment_items_tenant_idx on public.equipment_items(tenant_id, name);
create index equipment_items_category_idx on public.equipment_items(tenant_id, category_id);

create table public.equipment_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null,
  asset_code text not null check (length(trim(asset_code)) between 1 and 40),
  serial_number text,
  status public.asset_status not null default 'available',
  condition text not null default 'good',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, item_id) references public.equipment_items(tenant_id, id) on delete cascade
);
create unique index equipment_assets_code_uniq on public.equipment_assets(tenant_id, lower(asset_code));
create index equipment_assets_item_idx on public.equipment_assets(tenant_id, item_id, status);

-- Keep quantity_total of serialized items equal to the number of non-retired assets.
create or replace function app.sync_serialized_quantity() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item uuid := coalesce(new.item_id, old.item_id);
begin
  update public.equipment_items i
     set quantity_total = (select count(*) from public.equipment_assets a where a.item_id = v_item and a.status <> 'retired')
   where i.id = v_item and i.tracking = 'serialized';
  return null;
end $$;
create trigger equipment_assets_qty after insert or update or delete on public.equipment_assets
  for each row execute function app.sync_serialized_quantity();

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  contact_person text,
  phone text,
  whatsapp text check (whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
  email text,
  address text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index clients_tenant_idx on public.clients(tenant_id, name);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 160),
  location text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, client_id) references public.clients(tenant_id, id)
);
create unique index projects_name_uniq on public.projects(tenant_id, client_id, lower(name));

do $$
declare t text;
begin
  foreach t in array array['shift_rules','equipment_categories','suppliers','equipment_items','equipment_assets','clients','projects'] loop
    execute format('create trigger %1$s_touch before update on public.%1$s for each row execute function app.touch_updated_at()', t);
    execute format('create trigger %1$s_tenant before update on public.%1$s for each row execute function app.prevent_tenant_change()', t);
  end loop;
  foreach t in array array['equipment_items','equipment_assets','clients','suppliers','shift_rules'] loop
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$s for each row execute function app.audit_row()', t);
  end loop;
end $$;


-- ===== 20261028000003_rentals.sql =====
-- RW Production OS · Rentals: reservations, dispatches, returns, extensions, charges
-- All writes go through SECURITY DEFINER functions that verify the caller's role in the tenant,
-- lock inventory rows and keep availability consistent inside one transaction.

create type public.rental_type as enum ('shift', 'full_day', 'custom');
create type public.rental_status as enum ('reserved', 'dispatched', 'partially_returned', 'returned', 'cancelled', 'closed');

create table public.rentals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reference text not null,
  client_id uuid not null,
  project_id uuid,
  project_name text,
  location text,
  responsible_name text,
  responsible_whatsapp text check (responsible_whatsapp is null or responsible_whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
  rental_type public.rental_type not null,
  shift_rule_id uuid,
  shift_date date,
  -- Snapshot of the shift and billing terms that applied when the rental was created.
  terms jsonb not null default '{}'::jsonb,
  units int not null check (units between 1 and 366),
  billing_basis text not null check (billing_basis in ('shift', 'day')),
  start_at timestamptz not null,
  expected_return_at timestamptz not null check (expected_return_at > start_at),
  status public.rental_status not null default 'reserved',
  currency text not null default 'PKR',
  subtotal numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  charges_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  deposit_amount numeric(14,2) not null default 0 check (deposit_amount >= 0),
  deposit_invoiced boolean not null default false,
  dispatch_condition text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  dispatched_by uuid references auth.users(id) on delete set null,
  dispatched_at timestamptz,
  returned_at timestamptz,
  cancelled_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, reference),
  foreign key (tenant_id, client_id) references public.clients(tenant_id, id),
  foreign key (tenant_id, project_id) references public.projects(tenant_id, id),
  foreign key (tenant_id, shift_rule_id) references public.shift_rules(tenant_id, id)
);
create index rentals_status_idx on public.rentals(tenant_id, status, expected_return_at);
create index rentals_client_idx on public.rentals(tenant_id, client_id);
create index rentals_created_idx on public.rentals(tenant_id, created_at desc);

create table public.rental_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rental_id uuid not null,
  item_id uuid not null,
  asset_id uuid,
  description text not null,
  asset_code text,
  quantity int not null check (quantity > 0),
  qty_returned int not null default 0 check (qty_returned >= 0),
  qty_damaged int not null default 0 check (qty_damaged >= 0),
  qty_missing int not null default 0 check (qty_missing >= 0),
  unit_rate numeric(12,2) not null check (unit_rate >= 0),
  rate_source text not null,
  day_rate_snapshot numeric(12,2),
  line_total numeric(14,2) not null,
  condition_out text,
  condition_in text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, rental_id) references public.rentals(tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references public.equipment_items(tenant_id, id),
  foreign key (tenant_id, asset_id) references public.equipment_assets(tenant_id, id),
  check (qty_returned + qty_missing <= quantity),
  check (qty_damaged <= qty_returned),
  check (asset_id is null or quantity = 1)
);
create index rental_items_rental_idx on public.rental_items(tenant_id, rental_id);
create index rental_items_item_idx on public.rental_items(tenant_id, item_id);
create index rental_items_asset_idx on public.rental_items(asset_id) where asset_id is not null;

create table public.rental_charges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rental_id uuid not null,
  kind text not null check (kind in ('late_fee', 'damage', 'missing', 'extension', 'transport', 'crew', 'other')),
  description text not null,
  amount numeric(14,2) not null check (amount >= 0),
  calculation jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, rental_id) references public.rentals(tenant_id, id) on delete cascade
);
create index rental_charges_rental_idx on public.rental_charges(tenant_id, rental_id);

-- Dispatch, return, extension, deadline and cancellation history.
create table public.rental_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rental_id uuid not null,
  event_type text not null check (event_type in ('reserved','dispatched','returned','partial_return','extended','deadline_changed','charge_added','charge_removed','cancelled','closed','note')),
  occurred_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, rental_id) references public.rentals(tenant_id, id) on delete cascade
);
create index rental_events_rental_idx on public.rental_events(tenant_id, rental_id, occurred_at);
create index rental_events_recent_idx on public.rental_events(tenant_id, occurred_at desc);

create trigger rentals_touch before update on public.rentals for each row execute function app.touch_updated_at();
create trigger rentals_tenant before update on public.rentals for each row execute function app.prevent_tenant_change();
create trigger rental_items_touch before update on public.rental_items for each row execute function app.touch_updated_at();
create trigger rentals_audit after insert or update or delete on public.rentals for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Availability
-- ---------------------------------------------------------------------------
create or replace function app.bulk_outstanding(p_item uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(ri.quantity - ri.qty_returned - ri.qty_missing), 0)::int
  from public.rental_items ri
  join public.rentals r on r.id = ri.rental_id
  where ri.item_id = p_item and r.status in ('reserved', 'dispatched', 'partially_returned')
$$;

create or replace view public.v_equipment_availability with (security_invoker = true) as
select
  i.id, i.tenant_id, i.name, i.code, i.tracking, i.is_kit, i.category_id, c.name as category_name,
  i.shift_rate, i.day_rate, i.condition, i.archived_at,
  coalesce(i.shift_rate, c.default_shift_rate) as effective_shift_rate,
  coalesce(i.day_rate, c.default_day_rate) as effective_day_rate,
  i.quantity_total,
  case when i.tracking = 'serialized'
       then (select count(*) from public.equipment_assets a where a.item_id = i.id and a.status = 'reserved')::int
       else (select coalesce(sum(ri.quantity - ri.qty_returned - ri.qty_missing),0) from public.rental_items ri
             join public.rentals r on r.id = ri.rental_id where ri.item_id = i.id and r.status = 'reserved')::int end as qty_reserved,
  case when i.tracking = 'serialized'
       then (select count(*) from public.equipment_assets a where a.item_id = i.id and a.status = 'dispatched')::int
       else (select coalesce(sum(ri.quantity - ri.qty_returned - ri.qty_missing),0) from public.rental_items ri
             join public.rentals r on r.id = ri.rental_id where ri.item_id = i.id and r.status in ('dispatched','partially_returned'))::int end as qty_out,
  case when i.tracking = 'serialized'
       then (select count(*) from public.equipment_assets a where a.item_id = i.id and a.status in ('maintenance','damaged','missing'))::int
       else i.qty_maintenance + i.qty_damaged + i.qty_missing end as qty_unavailable,
  case when i.tracking = 'serialized'
       then (select count(*) from public.equipment_assets a where a.item_id = i.id and a.status = 'available')::int
       else greatest(i.quantity_total - i.qty_maintenance - i.qty_damaged - i.qty_missing
              - (select coalesce(sum(ri.quantity - ri.qty_returned - ri.qty_missing),0) from public.rental_items ri
                 join public.rentals r on r.id = ri.rental_id where ri.item_id = i.id and r.status in ('reserved','dispatched','partially_returned'))::int, 0) end as qty_available
from public.equipment_items i
left join public.equipment_categories c on c.id = i.category_id;

-- ---------------------------------------------------------------------------
-- Deadline & charge calculation (single source of truth, used for quotes and for saving)
-- ---------------------------------------------------------------------------
-- Shift: return at the end of the selected shift, on the last of `units` consecutive days.
--        A shift whose end time is not after its start time ends on the next calendar day.
-- Full day: `units` x 24h in local wall-clock time (correct across DST changes).
-- Custom: the user-provided deadline; billed per started 24h at the day rate.
create or replace function app.compute_deadline(
  p_type public.rental_type, p_start timestamptz, p_tz text, p_units int,
  p_shift_start time, p_shift_end time, p_shift_date date, p_custom_return timestamptz
) returns timestamptz language plpgsql stable as $$
declare v_date date;
begin
  if p_type = 'shift' then
    v_date := coalesce(p_shift_date, (p_start at time zone p_tz)::date) + (p_units - 1)
              + case when p_shift_end <= p_shift_start then 1 else 0 end;
    return (v_date + p_shift_end) at time zone p_tz;
  elsif p_type = 'full_day' then
    return ((p_start at time zone p_tz) + make_interval(days => p_units)) at time zone p_tz;
  else
    return p_custom_return;
  end if;
end $$;

create or replace function app.custom_units(p_start timestamptz, p_end timestamptz) returns int
language sql immutable as $$
  select greatest(1, ceil(extract(epoch from (p_end - p_start)) / 86400.0)::int)
$$;

-- Quote a rental without saving it. Returns deadline, units and per-line pricing.
-- p: { tenant_id, rental_type, shift_rule_id, shift_date, units, start_at, custom_return_at,
--      items: [{ item_id, quantity, unit_rate_override }] }
create or replace function public.quote_rental(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare
  v_tenant uuid := (p->>'tenant_id')::uuid;
  v_role public.membership_role;
  v_settings public.tenant_settings;
  v_type public.rental_type := (p->>'rental_type')::public.rental_type;
  v_shift public.shift_rules;
  v_start timestamptz := coalesce(nullif(p->>'start_at','')::timestamptz, now());
  v_units int := coalesce(nullif(p->>'units','')::int, 1);
  v_deadline timestamptz;
  v_basis text;
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_item record;
  v_qty int;
  v_rate numeric;
  v_source text;
  v_subtotal numeric := 0;
  v_mult numeric := 1;
begin
  v_role := app.require_role(v_tenant, 'staff');
  select * into v_settings from public.tenant_settings where tenant_id = v_tenant;

  if v_type = 'shift' then
    select * into v_shift from public.shift_rules where id = (p->>'shift_rule_id')::uuid and tenant_id = v_tenant and active;
    if not found then raise exception 'Select a valid shift'; end if;
    v_mult := v_shift.rate_multiplier;
    v_basis := 'shift';
  else
    v_basis := 'day';
  end if;

  if v_type <> 'custom' and (v_units < 1 or v_units > 366) then
    raise exception 'Number of shifts/days must be between 1 and 366';
  end if;

  v_deadline := app.compute_deadline(v_type, v_start, v_settings.timezone, v_units,
                  v_shift.start_time, v_shift.end_time, nullif(p->>'shift_date','')::date,
                  nullif(p->>'custom_return_at','')::timestamptz);
  if v_deadline is null then raise exception 'Return deadline is required for a custom rental'; end if;
  if v_deadline <= v_start then raise exception 'Return deadline must be after the dispatch time'; end if;
  if v_type = 'custom' then v_units := app.custom_units(v_start, v_deadline); end if;

  for v_line in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    select i.id, i.name, i.code, i.tracking, i.archived_at, i.shift_rate, i.day_rate,
           c.default_shift_rate, c.default_day_rate
      into v_item
      from public.equipment_items i left join public.equipment_categories c on c.id = i.category_id
     where i.id = (v_line->>'item_id')::uuid and i.tenant_id = v_tenant;
    if not found then raise exception 'Equipment item not found'; end if;
    v_qty := coalesce(nullif(v_line->>'quantity','')::int, 1);
    if v_qty < 1 then raise exception 'Quantity must be at least 1 for %', v_item.name; end if;

    if nullif(v_line->>'unit_rate_override','') is not null then
      if app.role_rank(v_role) < app.role_rank('manager') then
        raise exception 'Only managers and owners can override rates';
      end if;
      v_rate := (v_line->>'unit_rate_override')::numeric;
      if v_rate < 0 then raise exception 'Rate cannot be negative'; end if;
      v_source := 'manual override';
    elsif v_basis = 'shift' then
      v_rate := coalesce(v_item.shift_rate, v_item.default_shift_rate);
      v_source := case when v_item.shift_rate is not null then 'item shift rate' else 'category shift rate' end;
      if v_rate is null then raise exception 'No shift rate is configured for %', v_item.name; end if;
      if v_mult <> 1 then
        v_rate := round(v_rate * v_mult, 2);
        v_source := v_source || ' × ' || v_mult::text || ' (' || v_shift.name || ')';
      end if;
    else
      v_rate := coalesce(v_item.day_rate, v_item.default_day_rate);
      v_source := case when v_item.day_rate is not null then 'item day rate' else 'category day rate' end;
      if v_rate is null then raise exception 'No full-day rate is configured for %', v_item.name; end if;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'item_id', v_item.id, 'name', v_item.name, 'code', v_item.code, 'quantity', v_qty,
      'unit_rate', v_rate, 'rate_source', v_source, 'units', v_units,
      'day_rate', coalesce(v_item.day_rate, v_item.default_day_rate),
      'line_total', round(v_rate * v_units * v_qty, 2));
    v_subtotal := v_subtotal + round(v_rate * v_units * v_qty, 2);
  end loop;

  return jsonb_build_object(
    'start_at', v_start, 'expected_return_at', v_deadline, 'units', v_units, 'billing_basis', v_basis,
    'timezone', v_settings.timezone, 'currency', v_settings.currency,
    'shift', case when v_shift.id is null then null else jsonb_build_object(
      'id', v_shift.id, 'name', v_shift.name, 'start_time', v_shift.start_time,
      'end_time', v_shift.end_time, 'rate_multiplier', v_shift.rate_multiplier) end,
    'lines', v_lines, 'subtotal', v_subtotal);
end $$;

create or replace function app.recalc_rental(p_rental uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.rentals r set
    subtotal = coalesce((select sum(line_total) from public.rental_items where rental_id = r.id), 0),
    charges_total = coalesce((select sum(amount) from public.rental_charges where rental_id = r.id), 0),
    total = greatest(0, coalesce((select sum(line_total) from public.rental_items where rental_id = r.id), 0)
            + coalesce((select sum(amount) from public.rental_charges where rental_id = r.id), 0)
            - r.discount_amount)
  where r.id = p_rental;
end $$;

-- ---------------------------------------------------------------------------
-- Create rental (reserve or dispatch immediately)
-- p: quote_rental fields + { client_id, project_name, location, responsible_name, responsible_whatsapp,
--     deposit_amount, discount_amount, notes, dispatch_condition, dispatch_now,
--     items: [{ item_id, quantity, asset_ids, unit_rate_override, condition }] }
-- ---------------------------------------------------------------------------
create or replace function public.create_rental(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_tenant uuid := (p->>'tenant_id')::uuid;
  v_role public.membership_role;
  v_settings public.tenant_settings;
  v_quote jsonb;
  v_rental uuid;
  v_ref text;
  v_client uuid := (p->>'client_id')::uuid;
  v_project uuid;
  v_project_name text := nullif(trim(p->>'project_name'), '');
  v_dispatch boolean := coalesce((p->>'dispatch_now')::boolean, true);
  v_discount numeric := coalesce(nullif(p->>'discount_amount','')::numeric, 0);
  v_line jsonb;
  v_qline jsonb;
  v_idx int := 0;
  v_item public.equipment_items;
  v_qty int;
  v_assets uuid[];
  v_asset public.equipment_assets;
  v_available int;
  v_status public.rental_status;
begin
  v_role := app.require_role(v_tenant, 'staff');
  if v_discount > 0 and app.role_rank(v_role) < app.role_rank('manager') then
    raise exception 'Only managers and owners can apply discounts';
  end if;
  select * into v_settings from public.tenant_settings where tenant_id = v_tenant;
  if not exists (select 1 from public.clients where id = v_client and tenant_id = v_tenant and archived_at is null) then
    raise exception 'Client not found';
  end if;
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then
    raise exception 'Add at least one equipment item';
  end if;

  -- Lock every requested item row up front (ordered, to avoid deadlocks) before checking availability.
  perform 1 from public.equipment_items
   where tenant_id = v_tenant
     and id in (select (x->>'item_id')::uuid from jsonb_array_elements(p->'items') x)
   order by id for update;

  v_quote := public.quote_rental(p);

  if v_project_name is not null then
    insert into public.projects (tenant_id, client_id, name, location)
    values (v_tenant, v_client, v_project_name, nullif(trim(p->>'location'),''))
    on conflict (tenant_id, client_id, lower(name)) do update set location = coalesce(excluded.location, projects.location)
    returning id into v_project;
  end if;

  v_ref := v_settings.rental_prefix || '-' || lpad(app.next_counter(v_tenant, 'rental', '')::text, 4, '0');
  v_status := case when v_dispatch then 'dispatched' else 'reserved' end;

  insert into public.rentals (
    tenant_id, reference, client_id, project_id, project_name, location, responsible_name, responsible_whatsapp,
    rental_type, shift_rule_id, shift_date, terms, units, billing_basis, start_at, expected_return_at, status,
    currency, discount_amount, deposit_amount, dispatch_condition, notes, created_by,
    dispatched_by, dispatched_at)
  values (
    v_tenant, v_ref, v_client, v_project, v_project_name, nullif(trim(p->>'location'),''),
    nullif(trim(p->>'responsible_name'),''), nullif(trim(p->>'responsible_whatsapp'),''),
    (p->>'rental_type')::public.rental_type, nullif(p->>'shift_rule_id','')::uuid,
    case when p->>'rental_type' = 'shift'
         then coalesce(nullif(p->>'shift_date','')::date, ((v_quote->>'start_at')::timestamptz at time zone v_settings.timezone)::date) end,
    jsonb_build_object('shift', v_quote->'shift', 'timezone', v_settings.timezone,
      'grace_minutes', v_settings.grace_minutes, 'late_fee_mode', v_settings.late_fee_mode,
      'late_fee_amount', v_settings.late_fee_amount, 'currency', v_settings.currency),
    (v_quote->>'units')::int, v_quote->>'billing_basis', (v_quote->>'start_at')::timestamptz,
    (v_quote->>'expected_return_at')::timestamptz, v_status, v_settings.currency, v_discount,
    coalesce(nullif(p->>'deposit_amount','')::numeric, 0), nullif(trim(p->>'dispatch_condition'),''),
    nullif(trim(p->>'notes'),''), auth.uid(),
    case when v_dispatch then auth.uid() end, case when v_dispatch then (v_quote->>'start_at')::timestamptz end)
  returning id into v_rental;

  for v_line in select * from jsonb_array_elements(p->'items') loop
    v_qline := v_quote->'lines'->v_idx;
    v_idx := v_idx + 1;
    select * into v_item from public.equipment_items where id = (v_line->>'item_id')::uuid and tenant_id = v_tenant;
    if v_item.archived_at is not null then raise exception '% is archived', v_item.name; end if;
    v_qty := (v_qline->>'quantity')::int;

    if v_item.tracking = 'serialized' then
      select coalesce(array_agg(x::uuid), '{}') into v_assets
        from jsonb_array_elements_text(coalesce(v_line->'asset_ids','[]'::jsonb)) x;
      if cardinality(v_assets) = 0 then
        select coalesce(array_agg(id), '{}') into v_assets from (
          select id from public.equipment_assets
           where item_id = v_item.id and tenant_id = v_tenant and status = 'available'
           order by asset_code limit v_qty for update) s;
      end if;
      if cardinality(v_assets) <> v_qty then
        raise exception 'Only % unit(s) of % are available', cardinality(v_assets), v_item.name;
      end if;
      for v_asset in select * from public.equipment_assets
                      where id = any(v_assets) and tenant_id = v_tenant and item_id = v_item.id
                      order by asset_code for update loop
        if v_asset.status <> 'available' then
          raise exception '% (%) is not available (status: %)', v_item.name, v_asset.asset_code, v_asset.status;
        end if;
        insert into public.rental_items (tenant_id, rental_id, item_id, asset_id, description, asset_code, quantity,
          unit_rate, rate_source, day_rate_snapshot, line_total, condition_out)
        values (v_tenant, v_rental, v_item.id, v_asset.id, v_item.name, v_asset.asset_code, 1,
          (v_qline->>'unit_rate')::numeric, v_qline->>'rate_source', nullif(v_qline->>'day_rate','')::numeric,
          round((v_qline->>'unit_rate')::numeric * (v_quote->>'units')::int, 2), coalesce(nullif(v_line->>'condition',''), v_asset.condition));
        update public.equipment_assets set status = case when v_dispatch then 'dispatched' else 'reserved' end::public.asset_status
         where id = v_asset.id;
      end loop;
      if (select count(*) from public.rental_items where rental_id = v_rental and item_id = v_item.id) < v_qty then
        raise exception 'Selected assets do not belong to %', v_item.name;
      end if;
    else
      v_available := v_item.quantity_total - v_item.qty_maintenance - v_item.qty_damaged - v_item.qty_missing
                     - app.bulk_outstanding(v_item.id);
      if v_qty > v_available then
        raise exception 'Only % unit(s) of % are available', greatest(v_available, 0), v_item.name;
      end if;
      insert into public.rental_items (tenant_id, rental_id, item_id, description, asset_code, quantity,
        unit_rate, rate_source, day_rate_snapshot, line_total, condition_out)
      values (v_tenant, v_rental, v_item.id, v_item.name, v_item.code, v_qty,
        (v_qline->>'unit_rate')::numeric, v_qline->>'rate_source', nullif(v_qline->>'day_rate','')::numeric,
        (v_qline->>'line_total')::numeric, coalesce(nullif(v_line->>'condition',''), v_item.condition));
    end if;
  end loop;

  perform app.recalc_rental(v_rental);
  insert into public.rental_events (tenant_id, rental_id, event_type, occurred_at, data, created_by)
  values (v_tenant, v_rental, 'reserved', now(), jsonb_build_object('quote', v_quote), auth.uid());
  if v_dispatch then
    insert into public.rental_events (tenant_id, rental_id, event_type, occurred_at, data, created_by)
    values (v_tenant, v_rental, 'dispatched', (v_quote->>'start_at')::timestamptz,
            jsonb_build_object('condition', p->>'dispatch_condition'), auth.uid());
    perform app.schedule_rental_reminders(v_rental, true);
  end if;
  return v_rental;
end $$;

-- Dispatch a reservation. Full-day deadlines are recalculated from the actual dispatch time.
create or replace function public.dispatch_rental(p_rental uuid, p_dispatch_at timestamptz default null, p_condition text default null)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  r public.rentals;
  v_at timestamptz := coalesce(p_dispatch_at, now());
  v_deadline timestamptz;
begin
  select * into r from public.rentals where id = p_rental for update;
  if not found then raise exception 'Rental not found'; end if;
  perform app.require_role(r.tenant_id, 'staff');
  if r.status <> 'reserved' then raise exception 'Only reserved rentals can be dispatched (current status: %)', r.status; end if;

  v_deadline := r.expected_return_at;
  if r.rental_type = 'full_day' then
    v_deadline := app.compute_deadline(r.rental_type, v_at, r.terms->>'timezone', r.units, null, null, null, null);
  end if;
  if v_deadline <= v_at then raise exception 'The return deadline has already passed; extend or edit the rental first'; end if;

  update public.rentals set status = 'dispatched', dispatched_at = v_at, dispatched_by = auth.uid(),
    start_at = case when rental_type = 'full_day' then v_at else start_at end,
    expected_return_at = v_deadline,
    dispatch_condition = coalesce(nullif(trim(p_condition),''), dispatch_condition)
  where id = p_rental;
  update public.equipment_assets a set status = 'dispatched'
   from public.rental_items ri where ri.rental_id = p_rental and ri.asset_id = a.id;
  insert into public.rental_events (tenant_id, rental_id, event_type, occurred_at, data, created_by)
  values (r.tenant_id, p_rental, 'dispatched', v_at,
          jsonb_build_object('condition', p_condition, 'expected_return_at', v_deadline), auth.uid());
  perform app.schedule_rental_reminders(p_rental, true);
end $$;

-- ---------------------------------------------------------------------------
-- Returns (full or partial)
-- p: { rental_id, returned_at, notes, lines: [{ rental_item_id, returned, damaged, missing, condition }] }
-- ---------------------------------------------------------------------------
create or replace function public.record_return(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  r public.rentals;
  v_at timestamptz := coalesce(nullif(p->>'returned_at','')::timestamptz, now());
  v_line jsonb;
  ri public.rental_items;
  v_ret int; v_dmg int; v_mis int; v_outstanding int;
  v_late_minutes numeric;
  v_late_fee numeric := 0;
  v_late_units numeric := 0;
  v_mode text;
  v_fee_amount numeric;
  v_grace int;
  v_any boolean := false;
  v_remaining int;
  v_event_lines jsonb := '[]'::jsonb;
  v_new_status public.rental_status;
begin
  select * into r from public.rentals where id = (p->>'rental_id')::uuid for update;
  if not found then raise exception 'Rental not found'; end if;
  perform app.require_role(r.tenant_id, 'staff');
  if r.status not in ('dispatched', 'partially_returned') then
    raise exception 'This rental is not out (status: %)', r.status;
  end if;
  if v_at < r.dispatched_at then raise exception 'Return time cannot be before the dispatch time'; end if;
  if v_at > now() + interval '5 minutes' then raise exception 'Return time cannot be in the future'; end if;

  v_mode := coalesce(r.terms->>'late_fee_mode', 'none');
  v_fee_amount := coalesce((r.terms->>'late_fee_amount')::numeric, 0);
  v_grace := coalesce((r.terms->>'grace_minutes')::int, 0);
  v_late_minutes := extract(epoch from (v_at - r.expected_return_at)) / 60.0;

  for v_line in select * from jsonb_array_elements(coalesce(p->'lines','[]'::jsonb)) loop
    select * into ri from public.rental_items
     where id = (v_line->>'rental_item_id')::uuid and rental_id = r.id for update;
    if not found then raise exception 'Rental line not found'; end if;
    v_ret := coalesce(nullif(v_line->>'returned','')::int, 0);
    v_dmg := coalesce(nullif(v_line->>'damaged','')::int, 0);
    v_mis := coalesce(nullif(v_line->>'missing','')::int, 0);
    if v_ret < 0 or v_dmg < 0 or v_mis < 0 then raise exception 'Quantities cannot be negative'; end if;
    if v_ret + v_mis = 0 then continue; end if;
    v_outstanding := ri.quantity - ri.qty_returned - ri.qty_missing;
    if v_ret + v_mis > v_outstanding then
      raise exception 'Cannot return % unit(s) of %: only % outstanding', v_ret + v_mis, ri.description, v_outstanding;
    end if;
    if v_dmg > v_ret then raise exception 'Damaged quantity cannot exceed returned quantity for %', ri.description; end if;
    v_any := true;

    update public.rental_items set qty_returned = qty_returned + v_ret, qty_damaged = qty_damaged + v_dmg,
      qty_missing = qty_missing + v_mis, condition_in = coalesce(nullif(trim(v_line->>'condition'),''), condition_in)
     where id = ri.id;

    if ri.asset_id is not null then
      update public.equipment_assets set
        status = case when v_mis > 0 then 'missing' when v_dmg > 0 then 'damaged' else 'available' end::public.asset_status,
        condition = case when v_dmg > 0 then 'damaged' else condition end,
        notes = case when nullif(trim(v_line->>'condition'),'') is not null
                     then trim(v_line->>'condition') else notes end
       where id = ri.asset_id;
    else
      update public.equipment_items set qty_damaged = qty_damaged + v_dmg, qty_missing = qty_missing + v_mis
       where id = ri.item_id;
    end if;

    -- Late fee, only if the company has configured one (terms snapshot taken at dispatch).
    if v_mode <> 'none' and v_late_minutes > v_grace and v_ret > 0 then
      if v_mode = 'per_unit_per_hour' then
        v_late_units := ceil(v_late_minutes / 60.0);
        v_late_fee := v_late_fee + round(v_late_units * v_fee_amount * v_ret, 2);
      elsif v_mode = 'day_rate_per_day' then
        v_late_units := ceil(v_late_minutes / 1440.0);
        v_late_fee := v_late_fee + round(v_late_units * coalesce(ri.day_rate_snapshot, 0) * v_ret, 2);
      end if;
    end if;

    v_event_lines := v_event_lines || jsonb_build_object('rental_item_id', ri.id, 'description', ri.description,
      'asset_code', ri.asset_code, 'returned', v_ret, 'damaged', v_dmg, 'missing', v_mis, 'condition', v_line->>'condition');
  end loop;

  if not v_any then raise exception 'Enter at least one returned or missing quantity'; end if;

  if v_late_fee > 0 then
    insert into public.rental_charges (tenant_id, rental_id, kind, description, amount, calculation, created_by)
    values (r.tenant_id, r.id, 'late_fee',
      case when v_mode = 'per_unit_per_hour'
        then format('Late return: %s hour(s) late × %s per unit per hour', v_late_units, v_fee_amount)
        else format('Late return: %s extra day(s) at the item day rate', v_late_units) end,
      v_late_fee,
      jsonb_build_object('mode', v_mode, 'late_minutes', round(v_late_minutes), 'grace_minutes', v_grace,
        'units', v_late_units, 'rate', v_fee_amount, 'returned_at', v_at, 'deadline', r.expected_return_at),
      auth.uid());
  end if;

  select coalesce(sum(quantity - qty_returned - qty_missing), 0) into v_remaining from public.rental_items where rental_id = r.id;
  v_new_status := case when v_remaining = 0 then 'returned' else 'partially_returned' end;
  update public.rentals set status = v_new_status,
    returned_at = case when v_remaining = 0 then v_at else null end,
    notes = case when nullif(trim(p->>'notes'),'') is not null
                 then concat_ws(E'\n', notes, 'Return: ' || trim(p->>'notes')) else notes end
   where id = r.id;
  perform app.recalc_rental(r.id);

  insert into public.rental_events (tenant_id, rental_id, event_type, occurred_at, data, created_by)
  values (r.tenant_id, r.id, case when v_remaining = 0 then 'returned' else 'partial_return' end, v_at,
    jsonb_build_object('lines', v_event_lines, 'late_fee', v_late_fee, 'notes', p->>'notes',
      'late_minutes', greatest(round(v_late_minutes), 0)), auth.uid());

  if v_remaining = 0 then
    perform app.cancel_rental_reminders(r.id, 'Rental returned');
    perform app.schedule_confirmation(r.id, 'return_confirmation');
  end if;
  return jsonb_build_object('status', v_new_status, 'remaining', v_remaining, 'late_fee', v_late_fee);
end $$;

-- Extend a rental by additional shifts/days, or move a custom deadline. Reprices lines from the rate snapshot.
create or replace function public.extend_rental(p_rental uuid, p_additional_units int default null,
  p_new_deadline timestamptz default null, p_reason text default null)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  r public.rentals;
  v_units int;
  v_deadline timestamptz;
begin
  select * into r from public.rentals where id = p_rental for update;
  if not found then raise exception 'Rental not found'; end if;
  perform app.require_role(r.tenant_id, 'manager');
  if r.status not in ('reserved', 'dispatched', 'partially_returned') then
    raise exception 'Only open rentals can be extended';
  end if;

  if r.rental_type = 'custom' then
    if p_new_deadline is null or p_new_deadline <= r.start_at then raise exception 'Enter a new deadline after the start time'; end if;
    v_deadline := p_new_deadline;
    v_units := app.custom_units(r.start_at, v_deadline);
  else
    if coalesce(p_additional_units, 0) < 1 then raise exception 'Enter the number of additional shifts/days'; end if;
    v_units := r.units + p_additional_units;
    if v_units > 366 then raise exception 'Rental cannot exceed 366 shifts/days'; end if;
    v_deadline := app.compute_deadline(r.rental_type, r.start_at, r.terms->>'timezone', v_units,
      (r.terms->'shift'->>'start_time')::time, (r.terms->'shift'->>'end_time')::time, r.shift_date, null);
  end if;

  update public.rental_items set line_total = round(unit_rate * v_units * quantity, 2) where rental_id = r.id;
  update public.rentals set units = v_units, expected_return_at = v_deadline where id = r.id;
  perform app.recalc_rental(r.id);
  insert into public.rental_events (tenant_id, rental_id, event_type, data, created_by)
  values (r.tenant_id, r.id, case when r.rental_type = 'custom' then 'deadline_changed' else 'extended' end,
    jsonb_build_object('from_deadline', r.expected_return_at, 'to_deadline', v_deadline,
      'from_units', r.units, 'to_units', v_units, 'reason', p_reason), auth.uid());
  if r.status <> 'reserved' then
    perform app.schedule_rental_reminders(r.id, false);
  end if;
end $$;

create or replace function public.add_rental_charge(p_rental uuid, p_kind text, p_description text, p_amount numeric)
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.rentals; v_id uuid;
begin
  select * into r from public.rentals where id = p_rental for update;
  if not found then raise exception 'Rental not found'; end if;
  perform app.require_role(r.tenant_id, 'manager');
  if r.status in ('cancelled', 'closed') then raise exception 'Cannot add charges to a % rental', r.status; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Amount must be greater than zero'; end if;
  insert into public.rental_charges (tenant_id, rental_id, kind, description, amount, created_by)
  values (r.tenant_id, r.id, p_kind, coalesce(nullif(trim(p_description),''), initcap(p_kind)), round(p_amount, 2), auth.uid())
  returning id into v_id;
  perform app.recalc_rental(r.id);
  insert into public.rental_events (tenant_id, rental_id, event_type, data, created_by)
  values (r.tenant_id, r.id, 'charge_added', jsonb_build_object('kind', p_kind, 'description', p_description, 'amount', p_amount), auth.uid());
  return v_id;
end $$;

create or replace function public.remove_rental_charge(p_charge uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare c public.rental_charges; r public.rentals;
begin
  select * into c from public.rental_charges where id = p_charge;
  if not found then raise exception 'Charge not found'; end if;
  select * into r from public.rentals where id = c.rental_id for update;
  perform app.require_role(r.tenant_id, 'manager');
  if r.status in ('cancelled', 'closed') then raise exception 'Cannot change a % rental', r.status; end if;
  delete from public.rental_charges where id = p_charge;
  perform app.recalc_rental(r.id);
  insert into public.rental_events (tenant_id, rental_id, event_type, data, created_by)
  values (r.tenant_id, r.id, 'charge_removed', jsonb_build_object('kind', c.kind, 'description', c.description,
    'amount', c.amount, 'reason', p_reason), auth.uid());
end $$;

create or replace function public.cancel_rental(p_rental uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.rentals;
begin
  select * into r from public.rentals where id = p_rental for update;
  if not found then raise exception 'Rental not found'; end if;
  perform app.require_role(r.tenant_id, 'manager');
  if r.status <> 'reserved' then
    raise exception 'Only reservations can be cancelled. Record a return for dispatched equipment.';
  end if;
  update public.equipment_assets a set status = 'available'
    from public.rental_items ri where ri.rental_id = r.id and ri.asset_id = a.id and a.status = 'reserved';
  update public.rentals set status = 'cancelled', cancelled_at = now() where id = r.id;
  insert into public.rental_events (tenant_id, rental_id, event_type, data, created_by)
  values (r.tenant_id, r.id, 'cancelled', jsonb_build_object('reason', p_reason), auth.uid());
  perform app.cancel_rental_reminders(r.id, 'Rental cancelled');
end $$;

create or replace function public.close_rental(p_rental uuid)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r public.rentals;
begin
  select * into r from public.rentals where id = p_rental for update;
  if not found then raise exception 'Rental not found'; end if;
  perform app.require_role(r.tenant_id, 'manager');
  if r.status <> 'returned' then raise exception 'Only fully returned rentals can be closed'; end if;
  update public.rentals set status = 'closed', closed_at = now() where id = r.id;
  insert into public.rental_events (tenant_id, rental_id, event_type, created_by) values (r.tenant_id, r.id, 'closed', auth.uid());
end $$;

-- Rentals with client name and derived overdue flag.
create or replace view public.v_rentals with (security_invoker = true) as
select r.*, c.name as client_name, c.whatsapp as client_whatsapp,
  (r.status in ('dispatched','partially_returned') and r.expected_return_at < now()) as is_overdue,
  case when r.status in ('dispatched','partially_returned') and r.expected_return_at < now() then 'overdue'
       else r.status::text end as display_status,
  (select coalesce(sum(quantity),0) from public.rental_items ri where ri.rental_id = r.id)::int as item_count,
  (select coalesce(sum(quantity - qty_returned - qty_missing),0) from public.rental_items ri where ri.rental_id = r.id)::int as qty_outstanding
from public.rentals r join public.clients c on c.id = r.client_id;

-- ===== 20261028000004_invoices.sql =====
-- RW Production OS · Invoices & payments
-- Invoice lines are snapshots: changing equipment prices never alters an existing invoice.
-- Company and client details are snapshotted when the invoice is issued.

create type public.invoice_status as enum ('draft', 'issued', 'partially_paid', 'paid', 'void');

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null,
  client_id uuid not null,
  rental_id uuid,
  project_name text,
  issue_date date not null default current_date,
  due_date date not null,
  status public.invoice_status not null default 'draft',
  currency text not null default 'PKR',
  subtotal numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  tax_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  notes text,
  payment_instructions text,
  company_snapshot jsonb,
  client_snapshot jsonb,
  issued_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, number),
  foreign key (tenant_id, client_id) references public.clients(tenant_id, id),
  foreign key (tenant_id, rental_id) references public.rentals(tenant_id, id),
  check (due_date >= issue_date)
);
create index invoices_status_idx on public.invoices(tenant_id, status, due_date);
create index invoices_client_idx on public.invoices(tenant_id, client_id);
create index invoices_rental_idx on public.invoices(tenant_id, rental_id);
create index invoices_created_idx on public.invoices(tenant_id, created_at desc);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null,
  sort_order int not null default 0,
  description text not null check (length(trim(description)) between 1 and 300),
  quantity numeric(12,2) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  amount numeric(14,2) not null,
  foreign key (tenant_id, invoice_id) references public.invoices(tenant_id, id) on delete cascade
);
create index invoice_items_invoice_idx on public.invoice_items(tenant_id, invoice_id, sort_order);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  method text not null default 'cash' check (method in ('cash','bank_transfer','cheque','card','mobile_wallet','deposit','other')),
  reference text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices(tenant_id, id) on delete cascade
);
create index payments_invoice_idx on public.payments(tenant_id, invoice_id);
create index payments_paid_idx on public.payments(tenant_id, paid_at desc);

create trigger invoices_touch before update on public.invoices for each row execute function app.touch_updated_at();
create trigger invoices_tenant before update on public.invoices for each row execute function app.prevent_tenant_change();
create trigger invoices_audit after insert or update or delete on public.invoices for each row execute function app.audit_row();
create trigger payments_audit after insert or update or delete on public.payments for each row execute function app.audit_row();

create or replace function app.recalc_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sub numeric; v_paid numeric; inv public.invoices; v_taxable numeric; v_tax numeric; v_total numeric;
begin
  select * into inv from public.invoices where id = p_invoice;
  select coalesce(sum(amount), 0) into v_sub from public.invoice_items where invoice_id = p_invoice;
  select coalesce(sum(amount), 0) into v_paid from public.payments where invoice_id = p_invoice;
  v_taxable := greatest(v_sub - inv.discount_amount, 0);
  v_tax := round(v_taxable * inv.tax_rate / 100.0, 2);
  v_total := v_taxable + v_tax;
  update public.invoices set subtotal = v_sub, tax_amount = v_tax, total = v_total, amount_paid = v_paid,
    status = case
      when status = 'void' then 'void'
      when issued_at is null then 'draft'
      when v_paid >= v_total then 'paid'
      when v_paid > 0 then 'partially_paid'
      else 'issued' end::public.invoice_status
  where id = p_invoice;
end $$;

create or replace function app.company_snapshot(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('company_name', company_name, 'tagline', tagline, 'logo_path', logo_path,
    'brand_color', brand_color, 'phone', phone, 'whatsapp', whatsapp, 'email', email, 'address', address,
    'website', website, 'ntn', ntn, 'invoice_footer', invoice_footer)
  from public.tenant_settings where tenant_id = p_tenant
$$;

create or replace function app.client_snapshot(p_client uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('name', name, 'contact_person', contact_person, 'phone', phone,
    'whatsapp', whatsapp, 'email', email, 'address', address)
  from public.clients where id = p_client
$$;

create or replace function app.replace_invoice_items(p_invoice uuid, p_tenant uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_line jsonb; v_i int := 0; v_q numeric; v_p numeric;
begin
  delete from public.invoice_items where invoice_id = p_invoice;
  for v_line in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_q := coalesce(nullif(v_line->>'quantity','')::numeric, 1);
    v_p := coalesce(nullif(v_line->>'unit_price','')::numeric, 0);
    if v_q <= 0 then raise exception 'Line quantity must be greater than zero'; end if;
    if v_p < 0 then raise exception 'Line price cannot be negative'; end if;
    v_i := v_i + 1;
    insert into public.invoice_items (tenant_id, invoice_id, sort_order, description, quantity, unit_price, amount)
    values (p_tenant, p_invoice, v_i, trim(v_line->>'description'), v_q, v_p,
            coalesce(nullif(v_line->>'amount','')::numeric, round(v_q * v_p, 2)));
  end loop;
end $$;

-- Manual invoice (draft).
-- p: { tenant_id, client_id, rental_id, project_name, issue_date, due_date, discount_amount, tax_rate, notes,
--      payment_instructions, items: [{ description, quantity, unit_price }] }
create or replace function public.create_invoice(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_tenant uuid := (p->>'tenant_id')::uuid;
  s public.tenant_settings;
  v_id uuid;
  v_issue date;
  v_year text;
begin
  perform app.require_role(v_tenant, 'manager');
  select * into s from public.tenant_settings where tenant_id = v_tenant;
  if not exists (select 1 from public.clients where id = (p->>'client_id')::uuid and tenant_id = v_tenant) then
    raise exception 'Client not found';
  end if;
  if nullif(p->>'rental_id','') is not null and not exists (
      select 1 from public.rentals where id = (p->>'rental_id')::uuid and tenant_id = v_tenant
        and client_id = (p->>'client_id')::uuid) then
    raise exception 'Rental not found for this client';
  end if;
  v_issue := coalesce(nullif(p->>'issue_date','')::date, (now() at time zone s.timezone)::date);
  v_year := to_char(v_issue, 'YYYY');
  insert into public.invoices (tenant_id, number, client_id, rental_id, project_name, issue_date, due_date, currency,
    discount_amount, tax_rate, notes, payment_instructions, created_by)
  values (v_tenant,
    s.invoice_prefix || '-' || v_year || '-' || lpad(app.next_counter(v_tenant, 'invoice', v_year)::text, 3, '0'),
    (p->>'client_id')::uuid, nullif(p->>'rental_id','')::uuid, nullif(trim(p->>'project_name'),''),
    v_issue, coalesce(nullif(p->>'due_date','')::date, v_issue + s.payment_terms_days), s.currency,
    coalesce(nullif(p->>'discount_amount','')::numeric, 0), coalesce(nullif(p->>'tax_rate','')::numeric, s.tax_rate),
    nullif(trim(p->>'notes'),''), coalesce(nullif(trim(p->>'payment_instructions'),''), s.payment_instructions), auth.uid())
  returning id into v_id;
  perform app.replace_invoice_items(v_id, v_tenant, p->'items');
  perform app.recalc_invoice(v_id);
  return v_id;
end $$;

-- Update a draft invoice (header + lines).
create or replace function public.update_invoice_draft(p jsonb) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id = (p->>'invoice_id')::uuid for update;
  if not found then raise exception 'Invoice not found'; end if;
  perform app.require_role(inv.tenant_id, 'manager');
  if inv.status <> 'draft' then raise exception 'Only draft invoices can be edited'; end if;
  if not exists (select 1 from public.clients where id = (p->>'client_id')::uuid and tenant_id = inv.tenant_id) then
    raise exception 'Client not found';
  end if;
  update public.invoices set client_id = (p->>'client_id')::uuid,
    project_name = nullif(trim(p->>'project_name'),''),
    issue_date = coalesce(nullif(p->>'issue_date','')::date, issue_date),
    due_date = coalesce(nullif(p->>'due_date','')::date, due_date),
    discount_amount = coalesce(nullif(p->>'discount_amount','')::numeric, 0),
    tax_rate = coalesce(nullif(p->>'tax_rate','')::numeric, tax_rate),
    notes = nullif(trim(p->>'notes'),''),
    payment_instructions = nullif(trim(p->>'payment_instructions'),'')
  where id = inv.id;
  perform app.replace_invoice_items(inv.id, inv.tenant_id, p->'items');
  perform app.recalc_invoice(inv.id);
end $$;

-- Draft invoice from a rental: equipment lines, extra charges, discount, and the deposit as a payment.
create or replace function public.create_invoice_from_rental(p_rental uuid) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  r public.rentals;
  v_items jsonb;
  v_id uuid;
  v_unit_label text;
begin
  select * into r from public.rentals where id = p_rental for update;
  if not found then raise exception 'Rental not found'; end if;
  perform app.require_role(r.tenant_id, 'manager');
  if r.status = 'cancelled' then raise exception 'Cannot invoice a cancelled rental'; end if;
  if exists (select 1 from public.invoices where rental_id = r.id and status <> 'void') then
    raise exception 'This rental already has an invoice';
  end if;
  v_unit_label := case when r.billing_basis = 'shift'
    then r.units || ' shift' || case when r.units > 1 then 's' else '' end
         || coalesce(' (' || (r.terms->'shift'->>'name') || ')', '')
    else r.units || ' day' || case when r.units > 1 then 's' else '' end end;

  select coalesce(jsonb_agg(x order by x->>'o'), '[]'::jsonb) into v_items from (
    select jsonb_build_object('o', '1' || lpad(row_number() over (order by ri.description, ri.asset_code)::text, 4, '0'),
      'description', ri.description || coalesce(' · ' || ri.asset_code, '') || ' — ' || v_unit_label
                     || ' @ ' || to_char(ri.unit_rate, 'FM999,999,990.##'),
      'quantity', ri.quantity, 'unit_price', round(ri.unit_rate * r.units, 2), 'amount', ri.line_total) as x
    from public.rental_items ri where ri.rental_id = r.id
    union all
    select jsonb_build_object('o', '2' || lpad(row_number() over (order by rc.created_at)::text, 4, '0'),
      'description', rc.description, 'quantity', 1, 'unit_price', rc.amount, 'amount', rc.amount)
    from public.rental_charges rc where rc.rental_id = r.id
  ) s;

  v_id := public.create_invoice(jsonb_build_object('tenant_id', r.tenant_id, 'client_id', r.client_id,
    'rental_id', r.id, 'project_name', coalesce(r.project_name, r.reference),
    'discount_amount', r.discount_amount, 'items', v_items,
    'notes', 'Rental ' || r.reference));

  if r.deposit_amount > 0 and not r.deposit_invoiced then
    insert into public.payments (tenant_id, invoice_id, amount, paid_at, method, reference, notes, created_by)
    values (r.tenant_id, v_id, r.deposit_amount, coalesce(r.dispatched_at, r.created_at), 'deposit', r.reference,
            'Advance/deposit collected at dispatch', auth.uid());
    update public.rentals set deposit_invoiced = true where id = r.id;
    perform app.recalc_invoice(v_id);
  end if;
  return v_id;
end $$;

create or replace function public.issue_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  perform app.require_role(inv.tenant_id, 'manager');
  if inv.status <> 'draft' then raise exception 'Invoice is already issued'; end if;
  if not exists (select 1 from public.invoice_items where invoice_id = inv.id) then
    raise exception 'Add at least one line item before issuing';
  end if;
  update public.invoices set issued_at = now(), status = 'issued',
    company_snapshot = app.company_snapshot(inv.tenant_id), client_snapshot = app.client_snapshot(inv.client_id)
  where id = inv.id;
  perform app.recalc_invoice(inv.id);
end $$;

create or replace function public.void_invoice(p_invoice uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  perform app.require_role(inv.tenant_id, 'owner');
  if inv.status = 'void' then return; end if;
  if inv.amount_paid > 0 then raise exception 'Remove recorded payments before voiding this invoice'; end if;
  update public.invoices set status = 'void', voided_at = now(), void_reason = nullif(trim(p_reason),'') where id = inv.id;
  if inv.rental_id is not null then
    update public.rentals set deposit_invoiced = false where id = inv.rental_id
      and not exists (select 1 from public.payments where invoice_id = inv.id and method = 'deposit');
  end if;
end $$;

create or replace function public.delete_draft_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  perform app.require_role(inv.tenant_id, 'manager');
  if inv.status <> 'draft' then raise exception 'Only drafts can be deleted; void issued invoices instead'; end if;
  if inv.rental_id is not null and exists (select 1 from public.payments where invoice_id = inv.id and method = 'deposit') then
    update public.rentals set deposit_invoiced = false where id = inv.rental_id;
  end if;
  delete from public.invoices where id = inv.id;
end $$;

-- Record a payment. Locks the invoice so concurrent payments cannot overpay it.
create or replace function public.record_payment(p_invoice uuid, p_amount numeric, p_paid_at timestamptz default null,
  p_method text default 'cash', p_reference text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare inv public.invoices; v_id uuid;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  perform app.require_role(inv.tenant_id, 'manager');
  if inv.status = 'void' then raise exception 'Cannot record a payment on a void invoice'; end if;
  if inv.status = 'draft' then raise exception 'Issue the invoice before recording payments'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Payment amount must be greater than zero'; end if;
  if round(p_amount, 2) > inv.total - inv.amount_paid then
    raise exception 'Payment exceeds the outstanding balance of %', inv.total - inv.amount_paid;
  end if;
  insert into public.payments (tenant_id, invoice_id, amount, paid_at, method, reference, notes, created_by)
  values (inv.tenant_id, inv.id, round(p_amount, 2), coalesce(p_paid_at, now()), coalesce(p_method, 'cash'),
          nullif(trim(p_reference),''), nullif(trim(p_notes),''), auth.uid())
  returning id into v_id;
  perform app.recalc_invoice(inv.id);
  return v_id;
end $$;

create or replace function public.delete_payment(p_payment uuid) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare pay public.payments; inv public.invoices;
begin
  select * into pay from public.payments where id = p_payment;
  if not found then raise exception 'Payment not found'; end if;
  select * into inv from public.invoices where id = pay.invoice_id for update;
  perform app.require_role(inv.tenant_id, 'owner');
  delete from public.payments where id = pay.id;
  if pay.method = 'deposit' and inv.rental_id is not null then
    update public.rentals set deposit_invoiced = false where id = inv.rental_id;
  end if;
  perform app.recalc_invoice(inv.id);
end $$;

create or replace view public.v_invoices with (security_invoker = true) as
select i.*, c.name as client_name, c.whatsapp as client_whatsapp,
  (i.total - i.amount_paid) as balance,
  (i.status in ('issued','partially_paid') and i.due_date <
     (now() at time zone coalesce((select timezone from public.tenant_settings s where s.tenant_id = i.tenant_id), 'UTC'))::date) as is_overdue,
  case when i.status in ('issued','partially_paid') and i.due_date <
     (now() at time zone coalesce((select timezone from public.tenant_settings s where s.tenant_id = i.tenant_id), 'UTC'))::date
     then 'overdue' else i.status::text end as display_status,
  r.reference as rental_reference
from public.invoices i
join public.clients c on c.id = i.client_id
left join public.rentals r on r.id = i.rental_id;

-- ===== 20261028000005_messaging.sql =====
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

-- ===== 20261028000006_rls.sql =====
-- RW Production OS · Row Level Security, grants and inventory guards
-- Principle: every tenant-owned row is visible only to active members of that tenant.
-- Financial and operational ledgers (rentals, invoices, payments, reminders, messages) are written only
-- through the SECURITY DEFINER functions above, so the authenticated role has SELECT only on them.

-- ---------------------------------------------------------------------------
-- Grants: start from nothing for anon, read-only for authenticated, then open what is needed.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
revoke all on public.messaging_credentials, public.tenant_counters from authenticated;

grant insert, update, delete on public.equipment_items, public.equipment_assets, public.equipment_categories,
  public.suppliers, public.clients, public.projects, public.shift_rules, public.reminder_rules to authenticated;
grant update on public.tenant_settings to authenticated;
grant update (full_name, phone) on public.user_profiles to authenticated;

-- Functions: nothing for anon; service-role-only functions are not executable by authenticated users.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.provision_tenant(text, text, uuid, public.tenant_plan) from authenticated;
revoke execute on function public.claim_due_reminders(int, uuid) from authenticated;
revoke execute on all functions in schema app from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Platform
create policy tenants_select on public.tenants for select to authenticated
  using (app.is_member(id) or app.is_platform_admin());
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = auth.uid());

-- Profiles: yourself, and colleagues in a tenant you belong to.
create policy user_profiles_select on public.user_profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from public.tenant_memberships m where m.user_id = user_profiles.id and app.is_member(m.tenant_id)));
create policy user_profiles_update on public.user_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Memberships: members see their tenant's team (writes happen in server code after an owner check).
create policy memberships_select on public.tenant_memberships for select to authenticated
  using (user_id = auth.uid() or app.is_member(tenant_id));

-- Settings: members read, owners update.
create policy settings_select on public.tenant_settings for select to authenticated using (app.is_member(tenant_id));
create policy settings_update on public.tenant_settings for update to authenticated
  using (app.has_min_role(tenant_id, 'owner')) with check (app.has_min_role(tenant_id, 'owner'));

create policy audit_select on public.audit_logs for select to authenticated using (app.has_min_role(tenant_id, 'manager'));

-- Generic tenant tables: members read; writes by role.
do $$
declare
  spec record;
begin
  for spec in select * from (values
      ('equipment_items',      'manager', 'manager', 'manager'),
      ('equipment_assets',     'manager', 'manager', 'manager'),
      ('equipment_categories', 'manager', 'manager', 'manager'),
      ('suppliers',            'manager', 'manager', 'manager'),
      ('clients',              'staff',   'manager', 'owner'),
      ('projects',             'staff',   'manager', 'manager'),
      ('shift_rules',          'owner',   'owner',   'owner'),
      ('reminder_rules',       'owner',   'owner',   'owner')
    ) as v(tbl, ins, upd, del)
  loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (app.is_member(tenant_id))', spec.tbl);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (app.has_min_role(tenant_id, %2$L))', spec.tbl, spec.ins);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (app.has_min_role(tenant_id, %2$L)) with check (app.has_min_role(tenant_id, %2$L))', spec.tbl, spec.upd);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (app.has_min_role(tenant_id, %2$L))', spec.tbl, spec.del);
  end loop;

  -- Read-only (for users) ledgers.
  for spec in select * from (values ('rentals'), ('rental_items'), ('rental_charges'), ('rental_events'),
      ('invoices'), ('invoice_items'), ('payments'), ('scheduled_reminders'), ('message_logs'),
      ('messaging_connections')) as v(tbl)
  loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (app.is_member(tenant_id))', spec.tbl);
  end loop;
end $$;
-- messaging_credentials and tenant_counters intentionally have no policies (deny all).

-- ---------------------------------------------------------------------------
-- Inventory guard: availability-driving asset states can only be changed by the rental functions.
-- ---------------------------------------------------------------------------
create or replace function app.guard_asset_status() returns trigger language plpgsql as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status in ('reserved', 'dispatched') then
      raise exception 'New assets cannot start as reserved or dispatched';
    end if;
  elsif new.status is distinct from old.status
     and (old.status in ('reserved', 'dispatched') or new.status in ('reserved', 'dispatched')) then
    raise exception 'Asset % is linked to a rental. Use dispatch/return to change its status.', old.asset_code;
  end if;
  return new;
end $$;
create trigger equipment_assets_guard before insert or update on public.equipment_assets
  for each row execute function app.guard_asset_status();

-- Bulk items: out-of-service counters cannot be set below zero or above stock net of rentals.
create or replace function app.guard_bulk_quantity() returns trigger language plpgsql as $$
begin
  if new.tracking = 'bulk' and tg_op = 'UPDATE' and current_user not in ('postgres', 'service_role', 'supabase_admin')
     and new.quantity_total - new.qty_maintenance - new.qty_damaged - new.qty_missing < app.bulk_outstanding(new.id) then
    raise exception 'Quantity cannot drop below the % unit(s) currently reserved or out on rent', app.bulk_outstanding(new.id);
  end if;
  if tg_op = 'UPDATE' and new.tracking <> old.tracking and exists (select 1 from public.rental_items where item_id = new.id) then
    raise exception 'Tracking mode cannot change once the item has rental history';
  end if;
  return new;
end $$;
create trigger equipment_items_guard before update on public.equipment_items
  for each row execute function app.guard_bulk_quantity();

-- ===== 20261028000007_storage.sql =====
-- RW Production OS · Private file storage
-- Bucket "tenant-files" is private. Object paths must start with the tenant id: <tenant_id>/logo-<ts>.png
-- Members can read their tenant's files (via short-lived signed URLs); owners can upload/replace/delete.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-files', 'tenant-files', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false;

create or replace function app.storage_tenant(p_name text) returns uuid
language plpgsql immutable as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end $$;
grant execute on function app.storage_tenant(text) to authenticated;

create policy tenant_files_select on storage.objects for select to authenticated
  using (bucket_id = 'tenant-files' and app.is_member(app.storage_tenant(name)));
create policy tenant_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tenant-files' and app.has_min_role(app.storage_tenant(name), 'owner'));
create policy tenant_files_update on storage.objects for update to authenticated
  using (bucket_id = 'tenant-files' and app.has_min_role(app.storage_tenant(name), 'owner'))
  with check (bucket_id = 'tenant-files' and app.has_min_role(app.storage_tenant(name), 'owner'));
create policy tenant_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tenant-files' and app.has_min_role(app.storage_tenant(name), 'owner'));

-- ===== 20261030000001_shift_date_auto.sql =====
-- RW Production OS · Shift date defaults to the next shift that has not ended yet.
-- Example: dispatching at 8 PM for an 11 AM–5 PM shift with no date chosen now means tomorrow's shift,
-- instead of today's shift that already ended. An explicitly chosen date is always respected.

create or replace function app.effective_shift_date(p_start timestamptz, p_tz text, p_shift_start time, p_shift_end time, p_given date)
returns date language plpgsql stable as $$
declare v_date date; v_end timestamptz;
begin
  if p_given is not null then return p_given; end if;
  v_date := (p_start at time zone p_tz)::date;
  -- An overnight shift that started yesterday may still be running.
  if p_shift_end <= p_shift_start and (p_start at time zone p_tz)::time < p_shift_end then
    v_date := v_date - 1;
  end if;
  v_end := ((v_date + case when p_shift_end <= p_shift_start then 1 else 0 end) + p_shift_end) at time zone p_tz;
  if v_end <= p_start then v_date := v_date + 1; end if;
  return v_date;
end $$;
grant execute on function app.effective_shift_date(timestamptz, text, time, time, date) to authenticated, service_role;

create or replace function public.quote_rental(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare
  v_tenant uuid := (p->>'tenant_id')::uuid;
  v_role public.membership_role;
  v_settings public.tenant_settings;
  v_type public.rental_type := (p->>'rental_type')::public.rental_type;
  v_shift public.shift_rules;
  v_start timestamptz := coalesce(nullif(p->>'start_at','')::timestamptz, now());
  v_units int := coalesce(nullif(p->>'units','')::int, 1);
  v_deadline timestamptz;
  v_basis text;
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_item record;
  v_qty int;
  v_rate numeric;
  v_source text;
  v_subtotal numeric := 0;
  v_mult numeric := 1;
  v_shift_date date;
begin
  v_role := app.require_role(v_tenant, 'staff');
  select * into v_settings from public.tenant_settings where tenant_id = v_tenant;

  if v_type = 'shift' then
    select * into v_shift from public.shift_rules where id = (p->>'shift_rule_id')::uuid and tenant_id = v_tenant and active;
    if not found then raise exception 'Select a valid shift'; end if;
    v_mult := v_shift.rate_multiplier;
    v_basis := 'shift';
  else
    v_basis := 'day';
  end if;

  if v_type <> 'custom' and (v_units < 1 or v_units > 366) then
    raise exception 'Number of shifts/days must be between 1 and 366';
  end if;

  if v_type = 'shift' then
    v_shift_date := app.effective_shift_date(v_start, v_settings.timezone, v_shift.start_time, v_shift.end_time,
                      nullif(p->>'shift_date','')::date);
  end if;
  v_deadline := app.compute_deadline(v_type, v_start, v_settings.timezone, v_units,
                  v_shift.start_time, v_shift.end_time, v_shift_date,
                  nullif(p->>'custom_return_at','')::timestamptz);
  if v_deadline is null then raise exception 'Return deadline is required for a custom rental'; end if;
  if v_deadline <= v_start then raise exception 'Return deadline must be after the dispatch time'; end if;
  if v_type = 'custom' then v_units := app.custom_units(v_start, v_deadline); end if;

  for v_line in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    select i.id, i.name, i.code, i.tracking, i.archived_at, i.shift_rate, i.day_rate,
           c.default_shift_rate, c.default_day_rate
      into v_item
      from public.equipment_items i left join public.equipment_categories c on c.id = i.category_id
     where i.id = (v_line->>'item_id')::uuid and i.tenant_id = v_tenant;
    if not found then raise exception 'Equipment item not found'; end if;
    v_qty := coalesce(nullif(v_line->>'quantity','')::int, 1);
    if v_qty < 1 then raise exception 'Quantity must be at least 1 for %', v_item.name; end if;

    if nullif(v_line->>'unit_rate_override','') is not null then
      if app.role_rank(v_role) < app.role_rank('manager') then
        raise exception 'Only managers and owners can override rates';
      end if;
      v_rate := (v_line->>'unit_rate_override')::numeric;
      if v_rate < 0 then raise exception 'Rate cannot be negative'; end if;
      v_source := 'manual override';
    elsif v_basis = 'shift' then
      v_rate := coalesce(v_item.shift_rate, v_item.default_shift_rate);
      v_source := case when v_item.shift_rate is not null then 'item shift rate' else 'category shift rate' end;
      if v_rate is null then raise exception 'No shift rate is configured for %', v_item.name; end if;
      if v_mult <> 1 then
        v_rate := round(v_rate * v_mult, 2);
        v_source := v_source || ' × ' || v_mult::text || ' (' || v_shift.name || ')';
      end if;
    else
      v_rate := coalesce(v_item.day_rate, v_item.default_day_rate);
      v_source := case when v_item.day_rate is not null then 'item day rate' else 'category day rate' end;
      if v_rate is null then raise exception 'No full-day rate is configured for %', v_item.name; end if;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'item_id', v_item.id, 'name', v_item.name, 'code', v_item.code, 'quantity', v_qty,
      'unit_rate', v_rate, 'rate_source', v_source, 'units', v_units,
      'day_rate', coalesce(v_item.day_rate, v_item.default_day_rate),
      'line_total', round(v_rate * v_units * v_qty, 2));
    v_subtotal := v_subtotal + round(v_rate * v_units * v_qty, 2);
  end loop;

  return jsonb_build_object(
    'start_at', v_start, 'expected_return_at', v_deadline, 'shift_date', v_shift_date, 'units', v_units, 'billing_basis', v_basis,
    'timezone', v_settings.timezone, 'currency', v_settings.currency,
    'shift', case when v_shift.id is null then null else jsonb_build_object(
      'id', v_shift.id, 'name', v_shift.name, 'start_time', v_shift.start_time,
      'end_time', v_shift.end_time, 'rate_multiplier', v_shift.rate_multiplier) end,
    'lines', v_lines, 'subtotal', v_subtotal);
end $$;

create or replace function public.create_rental(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_tenant uuid := (p->>'tenant_id')::uuid;
  v_role public.membership_role;
  v_settings public.tenant_settings;
  v_quote jsonb;
  v_rental uuid;
  v_ref text;
  v_client uuid := (p->>'client_id')::uuid;
  v_project uuid;
  v_project_name text := nullif(trim(p->>'project_name'), '');
  v_dispatch boolean := coalesce((p->>'dispatch_now')::boolean, true);
  v_discount numeric := coalesce(nullif(p->>'discount_amount','')::numeric, 0);
  v_line jsonb;
  v_qline jsonb;
  v_idx int := 0;
  v_item public.equipment_items;
  v_qty int;
  v_assets uuid[];
  v_asset public.equipment_assets;
  v_available int;
  v_status public.rental_status;
begin
  v_role := app.require_role(v_tenant, 'staff');
  if v_discount > 0 and app.role_rank(v_role) < app.role_rank('manager') then
    raise exception 'Only managers and owners can apply discounts';
  end if;
  select * into v_settings from public.tenant_settings where tenant_id = v_tenant;
  if not exists (select 1 from public.clients where id = v_client and tenant_id = v_tenant and archived_at is null) then
    raise exception 'Client not found';
  end if;
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then
    raise exception 'Add at least one equipment item';
  end if;

  -- Lock every requested item row up front (ordered, to avoid deadlocks) before checking availability.
  perform 1 from public.equipment_items
   where tenant_id = v_tenant
     and id in (select (x->>'item_id')::uuid from jsonb_array_elements(p->'items') x)
   order by id for update;

  v_quote := public.quote_rental(p);

  if v_project_name is not null then
    insert into public.projects (tenant_id, client_id, name, location)
    values (v_tenant, v_client, v_project_name, nullif(trim(p->>'location'),''))
    on conflict (tenant_id, client_id, lower(name)) do update set location = coalesce(excluded.location, projects.location)
    returning id into v_project;
  end if;

  v_ref := v_settings.rental_prefix || '-' || lpad(app.next_counter(v_tenant, 'rental', '')::text, 4, '0');
  v_status := case when v_dispatch then 'dispatched' else 'reserved' end;

  insert into public.rentals (
    tenant_id, reference, client_id, project_id, project_name, location, responsible_name, responsible_whatsapp,
    rental_type, shift_rule_id, shift_date, terms, units, billing_basis, start_at, expected_return_at, status,
    currency, discount_amount, deposit_amount, dispatch_condition, notes, created_by,
    dispatched_by, dispatched_at)
  values (
    v_tenant, v_ref, v_client, v_project, v_project_name, nullif(trim(p->>'location'),''),
    nullif(trim(p->>'responsible_name'),''), nullif(trim(p->>'responsible_whatsapp'),''),
    (p->>'rental_type')::public.rental_type, nullif(p->>'shift_rule_id','')::uuid,
    nullif(v_quote->>'shift_date','')::date,
    jsonb_build_object('shift', v_quote->'shift', 'timezone', v_settings.timezone,
      'grace_minutes', v_settings.grace_minutes, 'late_fee_mode', v_settings.late_fee_mode,
      'late_fee_amount', v_settings.late_fee_amount, 'currency', v_settings.currency),
    (v_quote->>'units')::int, v_quote->>'billing_basis', (v_quote->>'start_at')::timestamptz,
    (v_quote->>'expected_return_at')::timestamptz, v_status, v_settings.currency, v_discount,
    coalesce(nullif(p->>'deposit_amount','')::numeric, 0), nullif(trim(p->>'dispatch_condition'),''),
    nullif(trim(p->>'notes'),''), auth.uid(),
    case when v_dispatch then auth.uid() end, case when v_dispatch then (v_quote->>'start_at')::timestamptz end)
  returning id into v_rental;

  for v_line in select * from jsonb_array_elements(p->'items') loop
    v_qline := v_quote->'lines'->v_idx;
    v_idx := v_idx + 1;
    select * into v_item from public.equipment_items where id = (v_line->>'item_id')::uuid and tenant_id = v_tenant;
    if v_item.archived_at is not null then raise exception '% is archived', v_item.name; end if;
    v_qty := (v_qline->>'quantity')::int;

    if v_item.tracking = 'serialized' then
      select coalesce(array_agg(x::uuid), '{}') into v_assets
        from jsonb_array_elements_text(coalesce(v_line->'asset_ids','[]'::jsonb)) x;
      if cardinality(v_assets) = 0 then
        select coalesce(array_agg(id), '{}') into v_assets from (
          select id from public.equipment_assets
           where item_id = v_item.id and tenant_id = v_tenant and status = 'available'
           order by asset_code limit v_qty for update) s;
      end if;
      if cardinality(v_assets) <> v_qty then
        raise exception 'Only % unit(s) of % are available', cardinality(v_assets), v_item.name;
      end if;
      for v_asset in select * from public.equipment_assets
                      where id = any(v_assets) and tenant_id = v_tenant and item_id = v_item.id
                      order by asset_code for update loop
        if v_asset.status <> 'available' then
          raise exception '% (%) is not available (status: %)', v_item.name, v_asset.asset_code, v_asset.status;
        end if;
        insert into public.rental_items (tenant_id, rental_id, item_id, asset_id, description, asset_code, quantity,
          unit_rate, rate_source, day_rate_snapshot, line_total, condition_out)
        values (v_tenant, v_rental, v_item.id, v_asset.id, v_item.name, v_asset.asset_code, 1,
          (v_qline->>'unit_rate')::numeric, v_qline->>'rate_source', nullif(v_qline->>'day_rate','')::numeric,
          round((v_qline->>'unit_rate')::numeric * (v_quote->>'units')::int, 2), coalesce(nullif(v_line->>'condition',''), v_asset.condition));
        update public.equipment_assets set status = case when v_dispatch then 'dispatched' else 'reserved' end::public.asset_status
         where id = v_asset.id;
      end loop;
      if (select count(*) from public.rental_items where rental_id = v_rental and item_id = v_item.id) < v_qty then
        raise exception 'Selected assets do not belong to %', v_item.name;
      end if;
    else
      v_available := v_item.quantity_total - v_item.qty_maintenance - v_item.qty_damaged - v_item.qty_missing
                     - app.bulk_outstanding(v_item.id);
      if v_qty > v_available then
        raise exception 'Only % unit(s) of % are available', greatest(v_available, 0), v_item.name;
      end if;
      insert into public.rental_items (tenant_id, rental_id, item_id, description, asset_code, quantity,
        unit_rate, rate_source, day_rate_snapshot, line_total, condition_out)
      values (v_tenant, v_rental, v_item.id, v_item.name, v_item.code, v_qty,
        (v_qline->>'unit_rate')::numeric, v_qline->>'rate_source', nullif(v_qline->>'day_rate','')::numeric,
        (v_qline->>'line_total')::numeric, coalesce(nullif(v_line->>'condition',''), v_item.condition));
    end if;
  end loop;

  perform app.recalc_rental(v_rental);
  insert into public.rental_events (tenant_id, rental_id, event_type, occurred_at, data, created_by)
  values (v_tenant, v_rental, 'reserved', now(), jsonb_build_object('quote', v_quote), auth.uid());
  if v_dispatch then
    insert into public.rental_events (tenant_id, rental_id, event_type, occurred_at, data, created_by)
    values (v_tenant, v_rental, 'dispatched', (v_quote->>'start_at')::timestamptz,
            jsonb_build_object('condition', p->>'dispatch_condition'), auth.uid());
    perform app.schedule_rental_reminders(v_rental, true);
  end if;
  return v_rental;
end $$;

revoke execute on function public.quote_rental(jsonb), public.create_rental(jsonb) from public, anon;
grant execute on function public.quote_rental(jsonb), public.create_rental(jsonb) to authenticated;

-- ===== migration history =====
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name) values ('20261028000001', 'core') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261028000002', 'inventory') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261028000003', 'rentals') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261028000004', 'invoices') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261028000005', 'messaging') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261028000006', 'rls') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261028000007', 'storage') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261030000001', 'shift_date_auto') on conflict do nothing;
