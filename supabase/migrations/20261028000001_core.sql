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
