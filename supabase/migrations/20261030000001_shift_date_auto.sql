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
