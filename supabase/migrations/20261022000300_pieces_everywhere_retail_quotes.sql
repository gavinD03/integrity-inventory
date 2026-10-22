-- Everything is tracked, priced and min/max'd in PIECES. units_per_box = the supplier's box (purchase pack) size.
-- One-time conversion of any box-mode data from boxes to pieces (0 rows existed when this ran).
update public.items set unit_cost = unit_cost / units_per_box,
       min_override = min_override * units_per_box, max_override = max_override * units_per_box
 where mode = 'box' and coalesce(units_per_box, 0) > 0;
update public.price_breaks b set min_qty = b.min_qty * i.units_per_box, unit_price = b.unit_price / i.units_per_box
  from public.items i where i.id = b.item_id and i.mode = 'box' and coalesce(i.units_per_box, 0) > 0;
update public.ticket_lines l set qty = l.qty * i.units_per_box
  from public.items i where i.id = l.item_id and i.mode = 'box' and coalesce(i.units_per_box, 0) > 0;
update public.audit_counts c set expected = c.expected * i.units_per_box, counted = c.counted * i.units_per_box
  from public.items i where i.id = c.item_id and i.mode = 'box' and coalesce(i.units_per_box, 0) > 0;

-- Quote lines: suppliers give the retail (single piece, 1-off) price directly.
alter table public.supplier_quote_lines alter column list_unit_price drop expression;
alter table public.supplier_quote_lines add constraint supplier_quote_lines_list_unit_price_check check (list_unit_price >= 0);

create or replace function public.save_quote(p_round uuid, p_supplier uuid, p_file_name text, p_lines jsonb, p_status text default 'saved')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_q uuid; v_l jsonb; v_item uuid; v_existing uuid; v_n int := 0; v_sku text;
  v_pieces numeric; v_pack numeric; v_unit numeric;
begin
  if not public.is_manager() then raise exception 'Managers only'; end if;
  if p_status not in ('draft','saved') then raise exception 'Bad status'; end if;
  insert into public.supplier_quotes (round_id, supplier_id, file_name, status, uploaded_at, uploaded_by)
  values (p_round, p_supplier, p_file_name, p_status, now(), auth.uid())
  on conflict (round_id, supplier_id) do update
    set file_name = coalesce(excluded.file_name, public.supplier_quotes.file_name),
        status = excluded.status, uploaded_at = now(), uploaded_by = auth.uid()
  returning id into v_q;

  update public.supplier_quote_lines
     set pieces_per_pack = null, list_pack_price = null, list_unit_price = null, bulk_qty = null, bulk_unit_price = null, notes = null,
         match_status = case when requested then 'matched' else 'ignored' end
   where quote_id = v_q;

  for v_l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_item := nullif(v_l->>'item_id', '')::uuid;
    v_sku := nullif(trim(v_l->>'sku_raw'), '');
    v_pieces := nullif(v_l->>'pieces_per_pack', '')::numeric;
    v_pack := nullif(v_l->>'list_pack_price', '')::numeric;
    v_unit := coalesce(nullif(v_l->>'list_unit_price', '')::numeric,
                       case when v_pack is not null and v_pieces > 0 then v_pack / v_pieces end);
    v_existing := null;
    if v_item is not null then
      select id into v_existing from public.supplier_quote_lines
       where quote_id = v_q and item_id = v_item order by requested desc limit 1;
    elsif v_sku is not null then
      select id into v_existing from public.supplier_quote_lines
       where quote_id = v_q and item_id is null and lower(sku_raw) = lower(v_sku) limit 1;
    end if;
    if v_existing is not null then
      update public.supplier_quote_lines set
        item_id = v_item, pieces_per_pack = v_pieces, list_pack_price = v_pack, list_unit_price = v_unit,
        bulk_qty = nullif(v_l->>'bulk_qty', '')::numeric,
        bulk_unit_price = nullif(v_l->>'bulk_unit_price', '')::numeric,
        notes = nullif(v_l->>'notes', ''),
        sku_raw = coalesce(v_sku, sku_raw),
        description_raw = coalesce(nullif(v_l->>'description_raw', ''), description_raw),
        match_status = coalesce(nullif(v_l->>'match_status', ''), case when v_item is null then 'unmatched' else 'matched' end)
      where id = v_existing;
    else
      insert into public.supplier_quote_lines
        (quote_id, item_id, requested, sku_raw, description_raw, pieces_per_pack, list_pack_price, list_unit_price, bulk_qty, bulk_unit_price, notes, match_status)
      values (v_q, v_item, false, v_sku, nullif(v_l->>'description_raw', ''), v_pieces, v_pack, v_unit,
        nullif(v_l->>'bulk_qty', '')::numeric, nullif(v_l->>'bulk_unit_price', '')::numeric, nullif(v_l->>'notes', ''),
        coalesce(nullif(v_l->>'match_status', ''), case when v_item is null then 'unmatched' else 'matched' end));
    end if;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('quote_id', v_q, 'lines', v_n);
end $$;

-- Switching supplier sets cost per piece and adopts that supplier's box size.
create or replace function public.set_current_supplier(p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.supplier_quote_lines%rowtype; q public.supplier_quotes%rowtype;
begin
  if not public.is_manager() then raise exception 'Managers only'; end if;
  select * into l from public.supplier_quote_lines where id = p_line;
  if not found or l.item_id is null then raise exception 'Quote line not found or not matched to an item'; end if;
  if l.list_unit_price is null then raise exception 'This line has no retail price'; end if;
  select * into q from public.supplier_quotes where id = l.quote_id;
  perform set_config('app.source_quote_line', p_line::text, true);
  update public.items
     set supplier_id = q.supplier_id,
         supplier = (select name from public.suppliers where id = q.supplier_id),
         unit_cost = round(l.list_unit_price, 4),
         units_per_box = case when l.pieces_per_pack > 0 then l.pieces_per_pack::int else units_per_box end,
         mode = case when l.pieces_per_pack > 1 then 'box' else mode end,
         updated_at = now()
   where id = l.item_id;
  perform set_config('app.source_quote_line', '', true);
end $$;

create or replace function public.save_bulk_price(p_line uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.supplier_quote_lines%rowtype;
begin
  if not public.is_manager() then raise exception 'Managers only'; end if;
  select * into l from public.supplier_quote_lines where id = p_line;
  if not found or l.item_id is null then raise exception 'Quote line not found or not matched to an item'; end if;
  if l.bulk_qty is null or l.bulk_unit_price is null then raise exception 'This line has no bulk price'; end if;
  perform set_config('app.source_quote_line', p_line::text, true);
  insert into public.price_breaks (item_id, min_qty, unit_price) values (l.item_id, l.bulk_qty, round(l.bulk_unit_price, 4))
  on conflict (item_id, min_qty) do update set unit_price = excluded.unit_price;
  perform set_config('app.source_quote_line', '', true);
  return jsonb_build_object('min_qty', l.bulk_qty, 'unit_price', round(l.bulk_unit_price, 4));
end $$;

revoke execute on function public.save_quote(uuid, uuid, text, jsonb, text) from public, anon;
revoke execute on function public.set_current_supplier(uuid) from public, anon;
revoke execute on function public.save_bulk_price(uuid) from public, anon;
grant execute on function public.save_quote(uuid, uuid, text, jsonb, text) to authenticated;
grant execute on function public.set_current_supplier(uuid) to authenticated;
grant execute on function public.save_bulk_price(uuid) to authenticated;
