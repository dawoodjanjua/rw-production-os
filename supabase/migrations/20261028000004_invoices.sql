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
