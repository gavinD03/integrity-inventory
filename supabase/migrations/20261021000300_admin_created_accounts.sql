-- Accounts are created only through the admin-users edge function (service role), which stamps
-- app_metadata.created_via = 'admin' and pre-confirms the email. Public sign-ups are rejected.
alter table public.profiles add column if not exists active boolean not null default true;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role;
  v_truck uuid;
begin
  if coalesce(new.raw_app_meta_data->>'created_via', '') <> 'admin' then
    raise exception 'Accounts are created by the inventory manager';
  end if;

  if not exists (select 1 from public.profiles where role = 'owner') then
    v_role := 'owner';
  else
    v_role := case new.raw_app_meta_data->>'role'
      when 'owner' then 'owner'::public.user_role
      when 'manager' then 'manager'::public.user_role
      else 'tech'::public.user_role end;
  end if;

  begin
    v_truck := nullif(new.raw_app_meta_data->>'truck_id', '')::uuid;
  exception when others then v_truck := null; end;
  if v_truck is not null and not exists (select 1 from public.locations where id = v_truck and kind = 'truck') then
    v_truck := null;
  end if;

  insert into public.profiles (id, email, full_name, role, truck_id)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
          v_role, v_truck);
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
