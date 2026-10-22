-- Supplier Quotes tab + Phase 0 prerequisites.
-- Units: quote prices are per PIECE. items.unit_cost is per BOX for box-mode items, per unit otherwise.
-- Conversions happen in set_current_supplier / save_bulk_price and in the client comparison.

-- ── Phase 0 ────────────────────────────────────────────────────────────────
create unique index if not exists items_sku_unique on public.items (lower(trim(sku))) where sku is not null and trim(sku) <> '';

alter table public.items drop constraint if exists items_strategy_check;
update public.items set strategy = 'truck' where strategy = 'stock';
alter table public.items alter column strategy set default 'truck';
alter table public.items add constraint items_strategy_check check (strategy in ('truck','warehouse','job'));

alter table public.items add column if not exists owner text not null default 'manager'
  check (owner in ('manager','owner'));

alter table public.app_settings add column if not exists truck_cost_limit numeric not null default 250;
alter table public.app_settings add column if not exists quote_gap_flag_pct numeric not null default 10;

-- ── Suppliers ──────────────────────────────────────────────────────────────
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);
insert into public.suppliers (name) values ('Hughes'), ('Nelson Corporation'), ('Gorman'), ('Coast Pump'), ('Charger');

alter table public.items add column if not exists supplier_id uuid references public.suppliers(id);
create index if not exists items_supplier_id_idx on public.items (supplier_id);
update public.items i set supplier_id = s.id
  from public.suppliers s
 where i.supplier_id is null and i.supplier is not null and lower(trim(i.supplier)) = lower(s.name);

-- ── Quote rounds, quotes, lines ────────────────────────────────────────────
create table public.quote_rounds (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  kind text not null check (kind in ('full','top')),
  opened_at date not null default current_date,
  closed_at date,
  created_by uuid references public.profiles(id) default auth.uid()
);
create index on public.quote_rounds (created_by);

create table public.supplier_quotes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.quote_rounds(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  file_name text,
  uploaded_by uuid references public.profiles(id) default auth.uid(),
  uploaded_at timestamptz not null default now(),
  requested_at timestamptz,
  status text not null default 'draft' check (status in ('requested','draft','saved')),
  unique (round_id, supplier_id)
);
create index on public.supplier_quotes (supplier_id);
create index on public.supplier_quotes (uploaded_by);

create table public.supplier_quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.supplier_quotes(id) on delete cascade,
  item_id uuid references public.items(id),
  requested boolean not null default false,   -- true = on the request sent to the supplier
  sku_raw text,
  description_raw text,
  pieces_per_pack numeric check (pieces_per_pack > 0),
  list_pack_price numeric check (list_pack_price >= 0),
  list_unit_price numeric generated always as
    (case when pieces_per_pack > 0 then list_pack_price / pieces_per_pack end) stored,
  bulk_qty numeric check (bulk_qty > 0),
  bulk_unit_price numeric check (bulk_unit_price >= 0),
  notes text,
  match_status text not null default 'matched'
    check (match_status in ('matched','unmatched','manual','ignored'))
);
create index on public.supplier_quote_lines (quote_id);
create index on public.supplier_quote_lines (item_id);

-- ── Price change log (append-only) ─────────────────────────────────────────
create table public.price_change_log (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  field text not null,
  old_value text,
  new_value text,
  source_quote_line_id uuid references public.supplier_quote_lines(id) on delete set null,
  changed_by uuid references public.profiles(id) default auth.uid(),
  changed_at timestamptz not null default now()
);
create index on public.price_change_log (item_id);
create index on public.price_change_log (source_quote_line_id);
create index on public.price_change_log (changed_by);

-- Log every cost / supplier change, from any screen. Quote actions set app.source_quote_line.
create or replace function public.log_item_price_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_src uuid;
begin
  begin v_src := nullif(current_setting('app.source_quote_line', true), '')::uuid;
  exception when others then v_src := null; end;
  if new.unit_cost is distinct from old.unit_cost then
    insert into public.price_change_log (item_id, field, old_value, new_value, source_quote_line_id, changed_by)
    values (new.id, 'unit_cost', old.unit_cost::text, new.unit_cost::text, v_src, auth.uid());
  end if;
  if new.supplier_id is distinct from old.supplier_id then
    insert into public.price_change_log (item_id, field, old_value, new_value, source_quote_line_id, changed_by)
    values (new.id, 'supplier_id',
            (select name from public.suppliers where id = old.supplier_id),
            (select name from public.suppliers where id = new.supplier_id), v_src, auth.uid());
  end if;
  return new;
end $$;
create trigger items_price_log after update on public.items
for each row execute function public.log_item_price_change();

create or replace function public.log_price_break_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_src uuid;
begin
  begin v_src := nullif(current_setting('app.source_quote_line', true), '')::uuid;
  exception when others then v_src := null; end;
  if tg_op = 'INSERT' then
    insert into public.price_change_log (item_id, field, old_value, new_value, source_quote_line_id, changed_by)
    values (new.item_id, 'price_break', null, new.min_qty || ' @ ' || new.unit_price, v_src, auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.min_qty, new.unit_price) is distinct from (old.min_qty, old.unit_price) then
      insert into public.price_change_log (item_id, field, old_value, new_value, source_quote_line_id, changed_by)
      values (new.item_id, 'price_break', old.min_qty || ' @ ' || old.unit_price, new.min_qty || ' @ ' || new.unit_price, v_src, auth.uid());
    end if;
    return new;
  else
    if exists (select 1 from public.items where id = old.item_id) then
      insert into public.price_change_log (item_id, field, old_value, new_value, source_quote_line_id, changed_by)
      values (old.item_id, 'price_break', old.min_qty || ' @ ' || old.unit_price, null, v_src, auth.uid());
    end if;
    return old;
  end if;
end $$;
create trigger price_breaks_log after insert or update or delete on public.price_breaks
for each row execute function public.log_price_break_change();

create unique index if not exists price_breaks_item_qty_unique on public.price_breaks (item_id, min_qty);

-- ── RLS: manager / owner only ──────────────────────────────────────────────
alter table public.suppliers enable row level security;
alter table public.quote_rounds enable row level security;
alter table public.supplier_quotes enable row level security;
alter table public.supplier_quote_lines enable row level security;
alter table public.price_change_log enable row level security;

create policy "managers" on public.suppliers for all to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));
create policy "managers" on public.quote_rounds for all to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));
create policy "managers" on public.supplier_quotes for all to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));
create policy "managers" on public.supplier_quote_lines for all to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));
-- The log is read-only to everyone; rows are written by triggers only.
create policy "managers read" on public.price_change_log for select to authenticated
  using ((select public.is_manager()));

-- ── Quote RPCs ─────────────────────────────────────────────────────────────
-- create_quote_request and save_quote: see 20261022000200_quote_request_and_save.sql

-- Switch an item to the quoted supplier at that supplier's list price.
create or replace function public.set_current_supplier(p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.supplier_quote_lines%rowtype; q public.supplier_quotes%rowtype; i public.items%rowtype; v_cost numeric;
begin
  if not public.is_manager() then raise exception 'Managers only'; end if;
  select * into l from public.supplier_quote_lines where id = p_line;
  if not found or l.item_id is null then raise exception 'Quote line not found or not matched to an item'; end if;
  if l.list_unit_price is null then raise exception 'This line has no list price per piece'; end if;
  select * into q from public.supplier_quotes where id = l.quote_id;
  select * into i from public.items where id = l.item_id for update;
  v_cost := case when i.mode = 'box' then round(l.list_unit_price * coalesce(nullif(i.units_per_box, 0), 1), 4)
                 else round(l.list_unit_price, 4) end;
  perform set_config('app.source_quote_line', p_line::text, true);
  update public.items
     set supplier_id = q.supplier_id,
         supplier = (select name from public.suppliers where id = q.supplier_id),
         unit_cost = v_cost,
         updated_at = now()
   where id = i.id;
  perform set_config('app.source_quote_line', '', true);
end $$;

-- Save the quoted bulk price as a price break (in boxes for box-mode items).
create or replace function public.save_bulk_price(p_line uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.supplier_quote_lines%rowtype; i public.items%rowtype; v_qty numeric; v_price numeric; v_upb numeric;
begin
  if not public.is_manager() then raise exception 'Managers only'; end if;
  select * into l from public.supplier_quote_lines where id = p_line;
  if not found or l.item_id is null then raise exception 'Quote line not found or not matched to an item'; end if;
  if l.bulk_qty is null or l.bulk_unit_price is null then raise exception 'This line has no bulk price'; end if;
  select * into i from public.items where id = l.item_id;
  if i.mode = 'box' then
    v_upb := coalesce(nullif(i.units_per_box, 0), 1);
    v_qty := ceil(l.bulk_qty / v_upb);
    v_price := round(l.bulk_unit_price * v_upb, 4);
  else
    v_qty := l.bulk_qty;
    v_price := round(l.bulk_unit_price, 4);
  end if;
  perform set_config('app.source_quote_line', p_line::text, true);
  insert into public.price_breaks (item_id, min_qty, unit_price) values (i.id, v_qty, v_price)
  on conflict (item_id, min_qty) do update set unit_price = excluded.unit_price;
  perform set_config('app.source_quote_line', '', true);
  return jsonb_build_object('min_qty', v_qty, 'unit_price', v_price);
end $$;

revoke execute on function public.log_item_price_change() from public, anon, authenticated;
revoke execute on function public.log_price_break_change() from public, anon, authenticated;
revoke execute on function public.set_current_supplier(uuid) from public, anon;
revoke execute on function public.save_bulk_price(uuid) from public, anon;
grant execute on function public.set_current_supplier(uuid) to authenticated;
grant execute on function public.save_bulk_price(uuid) to authenticated;
