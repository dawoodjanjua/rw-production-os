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
