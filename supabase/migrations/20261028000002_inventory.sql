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

