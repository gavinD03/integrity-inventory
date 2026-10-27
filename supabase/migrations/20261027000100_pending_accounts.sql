-- Supabase Auth now inserts the user before applying app_metadata, so the created_via stamp
-- isn't visible to the insert trigger. Instead, the admin-users function (service role) writes a
-- pre-approval row first; the trigger only lets an account in if a fresh, unused approval exists
-- for that email (or if no owner exists yet: first-time setup). Public sign-ups are still rejected.
create table if not exists public.pending_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role public.user_role not null default 'tech',
  truck_id uuid references public.locations(id),
  full_name text,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index if not exists pending_accounts_email_idx on public.pending_accounts (lower(email));
alter table public.pending_accounts enable row level security; -- no policies: service role only

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p public.pending_accounts%rowtype;
  v_role public.user_role;
  v_truck uuid;
begin
  select * into p from public.pending_accounts
   where lower(email) = lower(new.email) and used_at is null and created_at > now() - interval '10 minutes'
   order by created_at desc limit 1;

  if not exists (select 1 from public.profiles where role = 'owner') then
    v_role := 'owner';                       -- first-time setup
  elsif p.id is null then
    raise exception 'Accounts are created by the inventory manager';
  else
    v_role := p.role;
    v_truck := p.truck_id;
  end if;

  if p.id is not null then update public.pending_accounts set used_at = now() where id = p.id; end if;
  if v_truck is not null and not exists (select 1 from public.locations where id = v_truck and kind = 'truck') then
    v_truck := null;
  end if;

  insert into public.profiles (id, email, full_name, role, truck_id)
  values (new.id, new.email,
          coalesce(nullif(p.full_name, ''), nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
          v_role, v_truck);
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
