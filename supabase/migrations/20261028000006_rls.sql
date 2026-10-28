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
