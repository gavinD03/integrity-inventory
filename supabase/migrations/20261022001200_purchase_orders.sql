-- Purchase orders: Reorder saves what was actually ordered (including items added by hand, e.g. a bulk carbon buy),
-- and Receive checks deliveries against it. Stock on order counts toward the reorder decision so nothing is ordered twice.
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  supplier_id uuid references public.suppliers(id),
  status text not null default 'open' check (status in ('open','received','closed','cancelled')),
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index on public.purchase_orders (status);
create index on public.purchase_orders (supplier_id);
create index on public.purchase_orders (created_by);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid not null references public.items(id),
  qty_ordered numeric not null check (qty_ordered > 0),
  qty_received numeric not null default 0 check (qty_received >= 0),
  unit_cost numeric,
  added_by_hand boolean not null default false,
  unique (po_id, item_id)
);
create index on public.purchase_order_lines (item_id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
create policy "managers read" on public.purchase_orders for select to authenticated using ((select public.is_manager()));
create policy "managers read" on public.purchase_order_lines for select to authenticated using ((select public.is_manager()));
-- Writes go through the functions below.

-- p_orders: [{supplier_id, note, lines: [{item_id, qty, manual}]}] → one PO per entry.
create or replace function public.place_orders(p_orders jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_o jsonb; v_l jsonb; v_id uuid; v_num bigint; v_out jsonb := '[]'::jsonb; v_qty numeric; v_item public.items%rowtype;
begin
  if not public.is_manager() then raise exception 'Only the inventory manager can place orders'; end if;
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then raise exception 'Nothing to order'; end if;
  for v_o in select * from jsonb_array_elements(p_orders) loop
    if jsonb_array_length(coalesce(v_o->'lines', '[]'::jsonb)) = 0 then continue; end if;
    insert into public.purchase_orders (supplier_id, note)
    values (nullif(v_o->>'supplier_id', '')::uuid, nullif(trim(v_o->>'note'), ''))
    returning id, number into v_id, v_num;
    for v_l in select * from jsonb_array_elements(v_o->'lines') loop
      v_qty := (v_l->>'qty')::numeric;
      if v_qty is null or v_qty <= 0 then raise exception 'Order quantities must be greater than zero'; end if;
      select * into v_item from public.items where id = (v_l->>'item_id')::uuid;
      if not found then raise exception 'Unknown item'; end if;
      insert into public.purchase_order_lines (po_id, item_id, qty_ordered, unit_cost, added_by_hand)
      values (v_id, v_item.id, v_qty, nullif(v_item.unit_cost, 0), coalesce((v_l->>'manual')::boolean, false))
      on conflict (po_id, item_id) do update set qty_ordered = purchase_order_lines.qty_ordered + excluded.qty_ordered;
    end loop;
    v_out := v_out || jsonb_build_object('id', v_id, 'number', v_num);
  end loop;
  return v_out;
end $$;

-- Posts a receive ticket into the warehouse, then applies the quantities to open orders
-- (the chosen order first, then oldest first). Orders with every line filled are marked received.
create or replace function public.receive_delivery(p_lines jsonb, p_po uuid default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wh uuid; v_ticket jsonb; v_l jsonb; v_left numeric; v_take numeric; r record; v_extra int := 0;
begin
  if not public.is_manager() then raise exception 'Only the inventory manager can receive deliveries'; end if;
  select id into v_wh from public.locations where kind = 'warehouse' and active order by sort limit 1;
  if v_wh is null then raise exception 'No warehouse location'; end if;
  v_ticket := public.submit_ticket('receive', null, v_wh, p_lines, null,
    coalesce(nullif(trim(p_note), ''), case when p_po is not null then 'PO-' || lpad((select number from public.purchase_orders where id = p_po)::text, 4, '0') else 'Supplier delivery' end));

  for v_l in select * from jsonb_array_elements(p_lines) loop
    v_left := (v_l->>'qty')::numeric;
    for r in
      select l.id, l.qty_ordered - l.qty_received as open_qty
      from public.purchase_order_lines l join public.purchase_orders o on o.id = l.po_id
      where l.item_id = (v_l->>'item_id')::uuid and o.status = 'open' and l.qty_received < l.qty_ordered
      order by (o.id = p_po) desc nulls last, o.created_at
    loop
      exit when v_left <= 0;
      v_take := least(v_left, r.open_qty);
      update public.purchase_order_lines set qty_received = qty_received + v_take where id = r.id;
      v_left := v_left - v_take;
    end loop;
    if v_left > 0 then v_extra := v_extra + 1; end if;
  end loop;

  update public.purchase_orders o set status = 'received', closed_at = now()
  where o.status = 'open' and not exists (
    select 1 from public.purchase_order_lines l where l.po_id = o.id and l.qty_received < l.qty_ordered);

  return v_ticket || jsonb_build_object('not_on_order', v_extra);
end $$;

-- closed = accept what arrived, the rest isn't coming; cancelled = nothing was received.
create or replace function public.set_order_status(p_po uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Only the inventory manager can change orders'; end if;
  if p_status not in ('closed','cancelled','open') then raise exception 'Invalid status'; end if;
  if p_status = 'cancelled' and exists (select 1 from public.purchase_order_lines where po_id = p_po and qty_received > 0) then
    raise exception 'Part of this order was received. Close it instead of cancelling.';
  end if;
  update public.purchase_orders set status = p_status, closed_at = case when p_status = 'open' then null else now() end where id = p_po;
end $$;

revoke execute on function public.place_orders(jsonb) from public, anon;
revoke execute on function public.receive_delivery(jsonb, uuid, text) from public, anon;
revoke execute on function public.set_order_status(uuid, text) from public, anon;
grant execute on function public.place_orders(jsonb) to authenticated;
grant execute on function public.receive_delivery(jsonb, uuid, text) to authenticated;
grant execute on function public.set_order_status(uuid, text) to authenticated;
