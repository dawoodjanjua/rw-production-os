-- RW Production OS · Explicit grants for the server (service role).
-- Hosted Supabase projects may not inherit the default function privileges that local development has,
-- so grant the server-only functions to service_role explicitly. Users (anon/authenticated) still cannot call them.
grant usage on schema app to service_role;
grant execute on all functions in schema app to service_role;
grant execute on all functions in schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
