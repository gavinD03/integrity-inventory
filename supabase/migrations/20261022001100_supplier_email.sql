alter table public.suppliers add column if not exists email text;
alter table public.suppliers add column if not exists contact_name text;
alter table public.supplier_quotes add column if not exists emailed_at timestamptz;
alter table public.supplier_quotes add column if not exists emailed_to text;
