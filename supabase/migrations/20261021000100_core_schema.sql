-- Integrity Inventory: core schema, roles, row-level security.
-- Applied to Supabase project iwt-inventory (tcevsrqvdfakyofqebkn).

create type public.user_role as enum ('tech','manager','owner');
create type public.location_kind as enum ('warehouse','truck');
create type public.ticket_type as enum ('load','job','transfer','adjust','receive','reverse');
create type public.ticket_status as enum ('applied','pending','confirmed','cancelled');

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind public.location_kind not null,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role public.user_role not null default 'tech',
  truck_id uuid references public.locations(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.app_settings (
  id int primary key default 1 check (id = 1),
  capital_rate numeric not null default 22,
  shrink_rate numeric not null default 2,
  tier4_addon numeric not null default 3,
  order_cycle_days int not null default 7,
  min_days_supply int not null default 30,
  max_days_supply int not null default 45,
  sl_t1 numeric not null default 98,
  sl_t2 numeric not null default 95,
  sl_t3 numeric not null default 98,
  sl_t4 numeric not null default 90,
  sl_critical numeric not null default 99,
  cash_cap numeric not null default 8000,
  updated_at timestamptz not null default now()
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text,
  category text,
  mode text not null default 'each' check (mode in ('each','box')),
  tier int not null default 3 check (tier between 1 and 4),
  critical boolean not null default false,
  serial_tracked boolean not null default false,
  strategy text not null default 'stock' check (strategy in ('stock','job')),
  unit_cost numeric not null default 0,
  units_per_box int,
  monthly_usage numeric not null default 0,
  usage_sd numeric not null default 0,
  lead_days int not null default 3,
  supplier text,
  backup_supplier text,
  backup_price numeric,
  trip_cost numeric not null default 0,
  shelf_life_months numeric,
  storage_max numeric,
  truck_par numeric not null default 0,
  min_override numeric,
  max_override numeric,
  override_note text,
  usage_source text not null default 'supplier history',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.price_breaks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  min_qty numeric not null check (min_qty > 0),
  unit_price numeric not null check (unit_price >= 0)
);

create table public.kits (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.kit_items (
  kit_id uuid not null references public.kits(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  qty numeric not null check (qty > 0),
  primary key (kit_id, item_id)
);

create table public.audits (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  status text not null default 'open' check (status in ('open','completed')),
  started_by uuid references public.profiles(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text,
  order_note text
);

-- The ledger: every stock movement is a ticket with lines. Quantities are never overwritten.
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  type public.ticket_type not null,
  status public.ticket_status not null default 'applied',
  from_location_id uuid references public.locations(id),
  to_location_id uuid references public.locations(id),
  job_ref text,
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  reverses_ticket_id uuid references public.tickets(id),
  reversed_by_ticket_id uuid references public.tickets(id),
  flagged boolean not null default false,
  flag_note text,
  audit_id uuid references public.audits(id),
  check (from_location_id is not null or to_location_id is not null)
);

create table public.ticket_lines (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  item_id uuid not null references public.items(id),
  qty numeric not null check (qty > 0),
  serial text
);

create table public.audit_counts (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  item_id uuid not null references public.items(id),
  location_id uuid not null references public.locations(id),
  expected numeric not null default 0,
  counted numeric not null,
  reason text,
  counted_by uuid references public.profiles(id) default auth.uid(),
  counted_at timestamptz not null default now(),
  unique (audit_id, item_id, location_id)
);

create index on public.tickets (from_location_id);
create index on public.tickets (to_location_id);
create index on public.tickets (created_by);
create index on public.tickets (created_at desc);
create index on public.ticket_lines (ticket_id);
create index on public.ticket_lines (item_id);
create index on public.price_breaks (item_id);
create index on public.audit_counts (audit_id);
create index on public.kit_items (item_id);
create index on public.profiles (truck_id);
create index on public.tickets (reverses_ticket_id);
create index on public.tickets (reversed_by_ticket_id);
create index on public.tickets (audit_id);
create index on public.tickets (confirmed_by);
create index on public.audit_counts (item_id);
create index on public.audit_counts (location_id);
create index on public.audit_counts (counted_by);
create index on public.audits (started_by);

create or replace function public.my_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.my_truck() returns uuid
language sql stable security definer set search_path = public as $$
  select truck_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('manager','owner') from public.profiles where id = auth.uid()), false)
$$;

-- New sign-up -> profile. Becomes owner if no owner exists yet; otherwise tech.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles where role = 'owner') then 'tech'::public.user_role else 'owner'::public.user_role end
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.locations enable row level security;
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.items enable row level security;
alter table public.price_breaks enable row level security;
alter table public.kits enable row level security;
alter table public.kit_items enable row level security;
alter table public.audits enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_lines enable row level security;
alter table public.audit_counts enable row level security;

create policy "read locations" on public.locations for select to authenticated using (true);
create policy "manage locations" on public.locations for all to authenticated using ((select public.is_manager())) with check ((select public.is_manager()));
create policy "read own or manager" on public.profiles for select to authenticated using (id = (select auth.uid()) or (select public.is_manager()));
create policy "read settings" on public.app_settings for select to authenticated using (true);
create policy "manage settings" on public.app_settings for update to authenticated using ((select public.is_manager())) with check ((select public.is_manager()));
create policy "read items" on public.items for select to authenticated using (true);
create policy "manage items" on public.items for all to authenticated using ((select public.is_manager())) with check ((select public.is_manager()));
create policy "read breaks" on public.price_breaks for select to authenticated using (true);
create policy "manage breaks" on public.price_breaks for all to authenticated using ((select public.is_manager())) with check ((select public.is_manager()));
create policy "read kits" on public.kits for select to authenticated using (true);
create policy "manage kits" on public.kits for all to authenticated using ((select public.is_manager())) with check ((select public.is_manager()));
create policy "read kit items" on public.kit_items for select to authenticated using (true);
create policy "manage kit items" on public.kit_items for all to authenticated using ((select public.is_manager())) with check ((select public.is_manager()));
create policy "read audits" on public.audits for select to authenticated using ((select public.is_manager()) or status = 'open');
-- Techs see only tickets they created or that touch their truck. Writes go through functions only.
create policy "read tickets" on public.tickets for select to authenticated using (
  (select public.is_manager())
  or created_by = (select auth.uid())
  or from_location_id = (select public.my_truck())
  or to_location_id = (select public.my_truck())
);
create policy "read ticket lines" on public.ticket_lines for select to authenticated using (
  exists (select 1 from public.tickets t where t.id = ticket_id)
);
create policy "read counts" on public.audit_counts for select to authenticated using (
  (select public.is_manager()) or location_id = (select public.my_truck())
);

insert into public.app_settings (id) values (1);
insert into public.locations (name, kind, sort) values
  ('Warehouse','warehouse',0), ('Truck 1','truck',1), ('Truck 2','truck',2), ('Truck 3','truck',3);
