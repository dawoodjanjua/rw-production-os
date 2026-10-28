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
