-- RW Production: company workspace, shift timings, booking terms and equipment list.
-- Run ONCE in Supabase -> SQL Editor -> New query, after production-setup.sql.
-- The owner is the user with the email below (create it first under Authentication -> Users).
-- Quantities start at 1 and rates are empty: set them per item in the app (Equipment -> item -> Edit),
-- or set category default rates in Settings -> Shifts & rates.

do $$
declare
  v_owner uuid;
  v_tenant uuid;
begin
  select id into v_owner from auth.users where email = 'ashfaqmre121@gmail.com';
  if v_owner is null then
    raise exception 'Create the user ashfaqmre121@gmail.com in Authentication -> Users first';
  end if;
  if exists (select 1 from public.tenants where slug = 'rw-production') then
    raise exception 'RW Production workspace already exists; nothing changed';
  end if;

  v_tenant := public.provision_tenant('RW Production', 'rw-production', v_owner, 'professional');

  update public.tenant_settings set
    company_name = 'RW Production',
    tagline = 'Where Quality Meets Creativity',
    phone = '+923315661019',
    whatsapp = '+923315661019',
    address = E'Shop #248, Rania Mall, Bank Road\nRawalpindi, Pakistan',
    currency = 'PKR',
    timezone = 'Asia/Karachi',
    invoice_prefix = 'RWP',
    rental_prefix = 'RNT',
    payment_instructions = E'All bookings are cash only (no credit).\n50% advance is required for all bookings.',
    invoice_footer = 'RW Production is not responsible for data loss - please use your own memory cards. Studio timings: 10 AM - 2 AM, 7 days a week. WhatsApp booking and confirmation available: 0331-5661019.'
  where tenant_id = v_tenant;

  -- Shift timings. The 2nd shift ends at midnight (12 AM), i.e. the start of the next day.
  update public.shift_rules set name = '1st Shift', start_time = '11:00', end_time = '17:00', sort_order = 1
   where tenant_id = v_tenant and name = 'Shift A';
  update public.shift_rules set name = '2nd Shift', start_time = '18:00', end_time = '00:00', sort_order = 2
   where tenant_id = v_tenant and name = 'Shift B';

  insert into public.equipment_categories (tenant_id, name) values (v_tenant, 'Gimbal')
  on conflict (tenant_id, name) do nothing;

  insert into public.equipment_items (tenant_id, category_id, name, code, tracking, quantity_total)
  select v_tenant, c.id, i.name, i.code, 'bulk', 1
  from (values
    ('Lighting', 'Godox AD600 Pro', 'LGT-01'),
    ('Lighting', 'Godox AD600BM', 'LGT-02'),
    ('Lighting', 'RGB Light Stick', 'LGT-03'),
    ('Lighting', 'Mini Smart LED', 'LGT-04'),
    ('Lighting', 'Godox CL288', 'LGT-05'),
    ('Lighting', 'Godox CL60', 'LGT-06'),
    ('Lighting', 'Octa Box', 'LGT-07'),
    ('Lighting', 'Soft Box', 'LGT-08'),
    ('Lighting', 'Beauty Dish', 'LGT-09'),
    ('Lighting', 'Product Photography Box', 'LGT-10'),
    ('Lighting', 'Product Rotator', 'LGT-11'),
    ('Lighting', 'Background Filters', 'LGT-12'),
    ('Lighting', 'Flashes (all types)', 'LGT-13'),
    ('Lighting', 'Video Light', 'LGT-14'),
    ('Lighting', 'RGB Panel', 'LGT-15'),
    ('Lighting', 'LED Pro Light', 'LGT-16'),
    ('Camera', 'Sony FX3', 'CAM-01'),
    ('Camera', 'Sony A7 IV', 'CAM-02'),
    ('Camera', 'Sony A7 III', 'CAM-03'),
    ('Camera', 'Sony A6400', 'CAM-04'),
    ('Camera', 'Nikon Z6 II', 'CAM-05'),
    ('Camera', 'Nikon Z5', 'CAM-06'),
    ('Camera', 'Nikon Z50', 'CAM-07'),
    ('Camera', 'Nikon Z30', 'CAM-08'),
    ('Camera', 'Nikon D750', 'CAM-09'),
    ('Camera', 'Nikon D610', 'CAM-10'),
    ('Camera', 'Nikon D7500', 'CAM-11'),
    ('Camera', 'Nikon D7200', 'CAM-12'),
    ('Camera', 'Nikon D7100', 'CAM-13'),
    ('Camera', 'Canon EOS R', 'CAM-14'),
    ('Camera', 'Canon 5D Mark III', 'CAM-15'),
    ('Camera', 'Canon 6D Mark II', 'CAM-16'),
    ('Camera', 'Canon 80D', 'CAM-17'),
    ('Lens', 'Sony E 28mm F2', 'LEN-01'),
    ('Lens', 'Sony E 35mm F1.8', 'LEN-02'),
    ('Lens', 'Sony E 50mm F1.8', 'LEN-03'),
    ('Lens', 'Sony E 85mm F1.8', 'LEN-04'),
    ('Lens', 'Sony E 16-50mm F3.5-5.6', 'LEN-05'),
    ('Lens', 'Sony E 24-70mm F4', 'LEN-06'),
    ('Lens', 'Sony GM 24-70mm F2.8', 'LEN-07'),
    ('Lens', 'Sony GM 200-600mm F3.5-5.6', 'LEN-08'),
    ('Lens', 'Sony GM 35mm F1.4', 'LEN-09'),
    ('Lens', 'Sony GM 50mm F1.4', 'LEN-10'),
    ('Lens', 'Sony GM 85mm F1.4', 'LEN-11'),
    ('Lens', 'Sigma Art 18-50mm F2.8 (Sony E)', 'LEN-12'),
    ('Lens', 'Sigma Art 16mm F1.8 (Sony E)', 'LEN-13'),
    ('Lens', 'Sigma Art 35mm F1.4 (Sony E)', 'LEN-14'),
    ('Lens', 'Sigma Art 85mm F1.4 (Sony E)', 'LEN-15'),
    ('Lens', 'Sigma Art 105mm F1.4 (Sony E)', 'LEN-16'),
    ('Lens', 'Tamron 20mm F2.8 (Sony E)', 'LEN-17'),
    ('Lens', 'Tamron 24mm F2.8 (Sony E)', 'LEN-18'),
    ('Lens', 'Tamron 35mm F2.8 (Sony E)', 'LEN-19'),
    ('Lens', 'Tamron 28-75mm F2.8 (Sony E)', 'LEN-20'),
    ('Lens', 'Nikkor F 24-70mm F2.8', 'LEN-21'),
    ('Lens', 'Nikkor F 24-120mm F4', 'LEN-22'),
    ('Lens', 'Nikkor F 85mm F1.8', 'LEN-23'),
    ('Lens', 'Nikkor F 50mm F1.4', 'LEN-24'),
    ('Lens', 'Nikkor F 50mm F1.8', 'LEN-25'),
    ('Lens', 'Sigma Art 24-70mm F2.8 (Nikon F)', 'LEN-26'),
    ('Lens', 'Tamron 28-75mm F2.8 (Nikon F)', 'LEN-27'),
    ('Lens', 'Tamron 70-200mm F2.8 VR II (Nikon F)', 'LEN-28'),
    ('Lens', 'Tamron 150-600mm F3.5-5.6 G II (Nikon F)', 'LEN-29'),
    ('Lens', 'Nikon Z 24-70mm F4', 'LEN-30'),
    ('Lens', 'Nikon Z 35mm F1.8', 'LEN-31'),
    ('Lens', 'Nikon Z 35mm F1.4', 'LEN-32'),
    ('Lens', 'Nikon Z 50mm F1.4', 'LEN-33'),
    ('Lens', 'Nikon Z 85mm F1.8', 'LEN-34'),
    ('Lens', 'Viltrox 20mm F2.8 (Nikon Z)', 'LEN-35'),
    ('Lens', 'Viltrox 85mm F1.8 (Nikon Z)', 'LEN-36'),
    ('Lens', 'Canon RF 35mm F1.8', 'LEN-37'),
    ('Lens', 'Canon EF 18-135mm F3.5-5.6', 'LEN-38'),
    ('Lens', 'Canon EF 24-105mm F2.8', 'LEN-39'),
    ('Lens', 'Canon EF 70-200mm F2.8 IS II', 'LEN-40'),
    ('Lens', 'Sigma Art 24-70mm F2.8 (Canon EF)', 'LEN-41'),
    ('Lens', 'Sigma Art 17-50mm F2.8 (Canon EF)', 'LEN-42'),
    ('Lens', 'Tamron 24-70mm F2.8 (Canon EF)', 'LEN-43'),
    ('Lens', 'Tamron 17-50mm F2.8 (Canon EF)', 'LEN-44'),
    ('Lens', 'Tamron 17-85mm F3.5-5.6 (Canon EF)', 'LEN-45'),
    ('Gimbal', 'DJI RS4', 'GMB-01'),
    ('Gimbal', 'DJI RS4 Mini', 'GMB-02'),
    ('Gimbal', 'DJI Ronin SC', 'GMB-03'),
    ('Gimbal', 'Zhiyun Crane 2', 'GMB-04'),
    ('Gimbal', 'Zhiyun Crane 2S', 'GMB-05'),
    ('Gimbal', 'Zhiyun Crane 3 Lab', 'GMB-06'),
    ('Gimbal', 'Zhiyun WEEBILL S', 'GMB-07'),
    ('Grip', 'C-Stand', 'GRP-01'),
    ('Grip', 'Tripod', 'GRP-02'),
    ('Grip', 'Monopod', 'GRP-03'),
    ('Audio', 'Wireless Mic', 'AUD-01'),
    ('Accessories', 'Mount Converter (all brands)', 'ACC-01')
  ) as i(category, name, code)
  join public.equipment_categories c on c.tenant_id = v_tenant and c.name = i.category;

  raise notice 'RW Production created with % equipment items', (select count(*) from public.equipment_items where tenant_id = v_tenant);
end $$;

select name, (select count(*) from public.equipment_items i where i.tenant_id = t.id) as items,
       (select string_agg(s.name || ' ' || to_char(s.start_time, 'HH12:MI AM') || '-' || to_char(s.end_time, 'HH12:MI AM'), ', ' order by s.sort_order)
          from public.shift_rules s where s.tenant_id = t.id) as shifts
from public.tenants t where slug = 'rw-production';
