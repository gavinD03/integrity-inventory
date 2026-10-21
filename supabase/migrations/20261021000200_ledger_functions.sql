-- Integrity Inventory: stock ledger functions. All writes go through these, which enforce role rules.

create or replace function public.ledger_qty(p_item uuid, p_location uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(q), 0) from (
    select -l.qty as q from public.ticket_lines l join public.tickets t on t.id = l.ticket_id
     where l.item_id = p_item and t.from_location_id = p_location and t.status in ('applied','pending','confirmed')
    union all
    select l.qty from public.ticket_lines l join public.tickets t on t.id = l.ticket_id
     where l.item_id = p_item and t.to_location_id = p_location and t.status in ('applied','confirmed')
  ) x
$$;

-- Pending transfers leave the sending truck immediately and arrive only when confirmed.
create or replace function public.stock_by_location()
returns table (item_id uuid, location_id uuid, qty numeric)
language sql stable security definer set search_path = public as $$
  with led as (
    select l.item_id, t.from_location_id as loc, -l.qty as q
      from public.ticket_lines l join public.tickets t on t.id = l.ticket_id
     where t.from_location_id is not null and t.status in ('applied','pending','confirmed')
    union all
    select l.item_id, t.to_location_id, l.qty
      from public.ticket_lines l join public.tickets t on t.id = l.ticket_id
     where t.to_location_id is not null and t.status in ('applied','confirmed')
  )
  select led.item_id, led.loc, sum(led.q)
    from led join public.locations loc on loc.id = led.loc
   where public.is_manager() or led.loc = public.my_truck() or loc.kind = 'warehouse'
   group by led.item_id, led.loc
$$;

create or replace function public.submit_ticket(
  p_type public.ticket_type, p_from uuid, p_to uuid, p_lines jsonb,
  p_job_ref text default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role;
  v_truck uuid;
  v_status public.ticket_status := 'applied';
  v_id uuid;
  v_num bigint;
  v_line jsonb;
  v_qty numeric;
  v_item public.items%rowtype;
begin
  select role, truck_id into v_role, v_truck from public.profiles where id = auth.uid();
  if v_role is null then raise exception 'Not signed in'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item';
  end if;
  if p_type = 'reverse' then raise exception 'Use reverse_ticket to reverse a ticket'; end if;

  if v_role = 'tech' then
    if v_truck is null then raise exception 'No truck assigned to you yet. Ask the inventory manager.'; end if;
    if p_type = 'load' then
      if p_to is distinct from v_truck then raise exception 'You can only load your own truck'; end if;
      if not exists (select 1 from public.locations where id = p_from and kind = 'warehouse') then
        raise exception 'Loads must come from the warehouse';
      end if;
    elsif p_type = 'job' then
      if p_from is distinct from v_truck then raise exception 'Job usage must come from your truck'; end if;
      p_to := null;
    elsif p_type = 'transfer' then
      if p_from is distinct from v_truck then raise exception 'Transfers must come from your truck'; end if;
      if p_to is null or p_to = v_truck or not exists (select 1 from public.locations where id = p_to and kind = 'truck') then
        raise exception 'Pick another truck to transfer to';
      end if;
    else
      raise exception 'Only the inventory manager can submit this ticket type';
    end if;
  else
    if p_type = 'load' and (p_from is null or p_to is null) then raise exception 'Load needs a from and to location'; end if;
    if p_type = 'job' then
      if p_from is null then raise exception 'Job usage needs a truck'; end if;
      p_to := null;
    end if;
    if p_type = 'transfer' and (p_from is null or p_to is null or p_from = p_to) then raise exception 'Transfer needs two different trucks'; end if;
    if p_type = 'receive' then
      if p_to is null then raise exception 'Receiving needs a destination'; end if;
      p_from := null;
    end if;
    if p_type = 'adjust' and ((p_from is null) = (p_to is null)) then
      raise exception 'Adjustment needs exactly one location';
    end if;
  end if;

  if p_type = 'transfer' then v_status := 'pending'; end if;

  insert into public.tickets (type, status, from_location_id, to_location_id, job_ref, note, created_by)
  values (p_type, v_status, p_from, p_to, nullif(trim(p_job_ref), ''), nullif(trim(p_note), ''), auth.uid())
  returning id, number into v_id, v_num;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantities must be greater than zero'; end if;
    select * into v_item from public.items where id = (v_line->>'item_id')::uuid;
    if not found then raise exception 'Unknown item'; end if;
    if p_type = 'job' and v_item.serial_tracked and coalesce(trim(v_line->>'serial'), '') = '' then
      raise exception 'Serial number required for %', v_item.name;
    end if;
    insert into public.ticket_lines (ticket_id, item_id, qty, serial)
    values (v_id, v_item.id, v_qty, nullif(trim(v_line->>'serial'), ''));
  end loop;

  return jsonb_build_object('id', v_id, 'number', v_num, 'status', v_status);
end $$;

create or replace function public.confirm_transfer(p_ticket uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tickets%rowtype;
begin
  select * into t from public.tickets where id = p_ticket for update;
  if not found or t.type <> 'transfer' or t.status <> 'pending' then raise exception 'Not a pending transfer'; end if;
  if not public.is_manager() and t.to_location_id is distinct from public.my_truck() then
    raise exception 'Only the receiving truck can confirm';
  end if;
  update public.tickets set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now() where id = p_ticket;
end $$;

create or replace function public.cancel_transfer(p_ticket uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tickets%rowtype;
begin
  select * into t from public.tickets where id = p_ticket for update;
  if not found or t.type <> 'transfer' or t.status <> 'pending' then raise exception 'Not a pending transfer'; end if;
  if not public.is_manager() and t.created_by is distinct from auth.uid() and t.from_location_id is distinct from public.my_truck() then
    raise exception 'Not allowed';
  end if;
  update public.tickets set status = 'cancelled' where id = p_ticket;
end $$;

create or replace function public.reverse_ticket(p_ticket uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tickets%rowtype; v_id uuid; v_num bigint;
begin
  if not public.is_manager() then raise exception 'Only the inventory manager can reverse tickets'; end if;
  select * into t from public.tickets where id = p_ticket for update;
  if not found then raise exception 'Ticket not found'; end if;
  if t.type = 'reverse' then raise exception 'A reversal cannot be reversed'; end if;
  if t.status not in ('applied','confirmed') then raise exception 'Only applied or received tickets can be reversed'; end if;
  if t.reversed_by_ticket_id is not null then raise exception 'Already reversed'; end if;
  insert into public.tickets (type, status, from_location_id, to_location_id, job_ref, note, created_by, reverses_ticket_id)
  values ('reverse', 'applied', t.to_location_id, t.from_location_id, t.job_ref,
          coalesce(nullif(trim(p_note), ''), 'Reversal'), auth.uid(), t.id)
  returning id, number into v_id, v_num;
  insert into public.ticket_lines (ticket_id, item_id, qty, serial)
  select v_id, item_id, qty, serial from public.ticket_lines where ticket_id = t.id;
  update public.tickets set reversed_by_ticket_id = v_id where id = t.id;
  return jsonb_build_object('id', v_id, 'number', v_num);
end $$;

create or replace function public.set_ticket_flag(p_ticket uuid, p_flag boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Only the inventory manager can flag tickets'; end if;
  update public.tickets set flagged = p_flag, flag_note = case when p_flag then nullif(trim(p_note), '') else null end
   where id = p_ticket;
end $$;

create or replace function public.update_profile(p_user uuid, p_role public.user_role, p_truck uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v_me public.user_role; v_target public.user_role;
begin
  select role into v_me from public.profiles where id = auth.uid();
  if v_me not in ('manager','owner') then raise exception 'Only the inventory manager can edit users'; end if;
  select role into v_target from public.profiles where id = p_user;
  if v_target is null then raise exception 'User not found'; end if;
  if (p_role = 'owner' or v_target = 'owner') and v_me <> 'owner' then
    raise exception 'Only an owner can change owner accounts';
  end if;
  if v_target = 'owner' and p_role <> 'owner'
     and (select count(*) from public.profiles where role = 'owner') <= 1 then
    raise exception 'There must be at least one owner';
  end if;
  if p_truck is not null and not exists (select 1 from public.locations where id = p_truck and kind = 'truck') then
    raise exception 'Pick a truck';
  end if;
  update public.profiles set role = p_role, truck_id = p_truck, full_name = coalesce(nullif(trim(p_name), ''), full_name)
   where id = p_user;
end $$;

create or replace function public.start_audit() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_manager() then raise exception 'Only the inventory manager can start an audit'; end if;
  select id into v_id from public.audits where status = 'open' order by started_at desc limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.audits (started_by) values (auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.save_count(p_audit uuid, p_item uuid, p_location uuid, p_counted numeric, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_expected numeric;
begin
  if not exists (select 1 from public.audits where id = p_audit and status = 'open') then raise exception 'Audit is not open'; end if;
  if not public.is_manager() and p_location is distinct from public.my_truck() then
    raise exception 'You can only count your own truck';
  end if;
  if p_counted is null or p_counted < 0 then raise exception 'Count must be zero or more'; end if;
  v_expected := public.ledger_qty(p_item, p_location);
  insert into public.audit_counts (audit_id, item_id, location_id, expected, counted, reason, counted_by, counted_at)
  values (p_audit, p_item, p_location, v_expected, p_counted, nullif(trim(p_reason), ''), auth.uid(), now())
  on conflict (audit_id, item_id, location_id)
  do update set expected = excluded.expected, counted = excluded.counted, reason = excluded.reason,
                counted_by = excluded.counted_by, counted_at = excluded.counted_at;
  return jsonb_build_object('expected', v_expected, 'counted', p_counted);
end $$;

-- Completing an audit posts one shortage and one overage adjustment ticket per location.
create or replace function public.complete_audit(p_audit uuid, p_notes text default null, p_order_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_loc uuid; v_tid uuid; v_tickets int := 0; v_audit public.audits%rowtype;
begin
  if not public.is_manager() then raise exception 'Only the inventory manager can complete an audit'; end if;
  select * into v_audit from public.audits where id = p_audit for update;
  if not found or v_audit.status <> 'open' then raise exception 'Audit is not open'; end if;

  for v_loc in select distinct location_id from public.audit_counts where audit_id = p_audit and counted < expected loop
    insert into public.tickets (type, from_location_id, note, created_by, audit_id)
    values ('adjust', v_loc, 'Audit #' || v_audit.number || ' count correction (shortage)', auth.uid(), p_audit)
    returning id into v_tid;
    insert into public.ticket_lines (ticket_id, item_id, qty)
    select v_tid, item_id, expected - counted from public.audit_counts
     where audit_id = p_audit and location_id = v_loc and counted < expected;
    v_tickets := v_tickets + 1;
  end loop;

  for v_loc in select distinct location_id from public.audit_counts where audit_id = p_audit and counted > expected loop
    insert into public.tickets (type, to_location_id, note, created_by, audit_id)
    values ('adjust', v_loc, 'Audit #' || v_audit.number || ' count correction (overage)', auth.uid(), p_audit)
    returning id into v_tid;
    insert into public.ticket_lines (ticket_id, item_id, qty)
    select v_tid, item_id, counted - expected from public.audit_counts
     where audit_id = p_audit and location_id = v_loc and counted > expected;
    v_tickets := v_tickets + 1;
  end loop;

  update public.audits set status = 'completed', completed_at = now(),
         notes = nullif(trim(p_notes), ''), order_note = nullif(trim(p_order_note), '')
   where id = p_audit;
  return jsonb_build_object('adjustment_tickets', v_tickets);
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on function public.ledger_qty(uuid, uuid) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;
grant execute on function public.stock_by_location() to authenticated;
grant execute on function public.submit_ticket(public.ticket_type, uuid, uuid, jsonb, text, text) to authenticated;
grant execute on function public.confirm_transfer(uuid) to authenticated;
grant execute on function public.cancel_transfer(uuid) to authenticated;
grant execute on function public.reverse_ticket(uuid, text) to authenticated;
grant execute on function public.set_ticket_flag(uuid, boolean, text) to authenticated;
grant execute on function public.update_profile(uuid, public.user_role, uuid, text) to authenticated;
grant execute on function public.start_audit() to authenticated;
grant execute on function public.save_count(uuid, uuid, uuid, numeric, text) to authenticated;
grant execute on function public.complete_audit(uuid, text, text) to authenticated;
grant execute on function public.my_role() to authenticated;
grant execute on function public.my_truck() to authenticated;
grant execute on function public.is_manager() to authenticated;

-- Seed: the carbon example (pallet price break 63 @ $119).
with i as (
  insert into public.items (name, category, mode, tier, unit_cost, monthly_usage, usage_sd, lead_days, truck_par, shelf_life_months)
  values ('Carbon media, 1 cu ft bag', 'Media', 'each', 3, 133, 10, 3, 3, 4, 24)
  returning id
)
insert into public.price_breaks (item_id, min_qty, unit_price) select id, 63, 119 from i;
