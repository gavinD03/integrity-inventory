-- An item's cost always follows its supplier's most recent saved quote.
--  • Setting/changing an item's supplier pulls that supplier's latest retail (1-off) price for it.
--  • Saving a supplier quote updates every item that has that supplier set.
-- "Most recent" = latest quote date (quote_rounds.opened_at), then latest upload. Drafts never apply.
-- Box qty is filled from the quote only when the item is bought by the box and has none yet.

create or replace function public.latest_quote_line(p_item uuid, p_supplier uuid)
returns public.supplier_quote_lines
language sql stable security definer set search_path = public as $$
  select l.*
  from public.supplier_quote_lines l
  join public.supplier_quotes q on q.id = l.quote_id
  join public.quote_rounds r on r.id = q.round_id
  where l.item_id = p_item and q.supplier_id = p_supplier and q.status = 'saved'
    and l.list_unit_price is not null and l.match_status <> 'ignored'
  order by r.opened_at desc, q.uploaded_at desc
  limit 1
$$;

-- BEFORE trigger on items: when the supplier changes (and the price wasn't typed in the same save), take the quote price.
create or replace function public.items_pull_quote_price() returns trigger
language plpgsql security definer set search_path = public as $$
declare l public.supplier_quote_lines%rowtype;
begin
  if new.supplier_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.supplier_id is not distinct from old.supplier_id then return new; end if;
  if tg_op = 'UPDATE' and new.unit_cost is distinct from old.unit_cost then return new; end if; -- price typed by hand wins
  if tg_op = 'INSERT' and coalesce(new.unit_cost, 0) > 0 then return new; end if;
  l := public.latest_quote_line(new.id, new.supplier_id);
  if l.id is null then return new; end if;
  perform set_config('app.source_quote_line', l.id::text, true);
  new.unit_cost := round(l.list_unit_price, 4);
  new.supplier := (select name from public.suppliers where id = new.supplier_id);
  if new.mode = 'box' and coalesce(new.units_per_box, 0) <= 1 and l.pieces_per_pack > 1 then
    new.units_per_box := l.pieces_per_pack::int;
  end if;
  return new;
end $$;

create trigger items_pull_quote_price before insert or update of supplier_id on public.items
for each row execute function public.items_pull_quote_price();

-- AFTER trigger on quote lines: a saved price updates items that use that supplier, if it's their latest quote.
create or replace function public.quote_line_push_price() returns trigger
language plpgsql security definer set search_path = public as $$
declare q public.supplier_quotes%rowtype; latest public.supplier_quote_lines%rowtype;
begin
  if new.item_id is null or new.list_unit_price is null then return null; end if;
  select * into q from public.supplier_quotes where id = new.quote_id;
  if q.status <> 'saved' then return null; end if;
  if not exists (select 1 from public.items where id = new.item_id and supplier_id = q.supplier_id) then return null; end if;
  latest := public.latest_quote_line(new.item_id, q.supplier_id);
  if latest.id is distinct from new.id then return null; end if;
  perform set_config('app.source_quote_line', new.id::text, true);
  update public.items i
     set unit_cost = round(new.list_unit_price, 4),
         units_per_box = case when i.mode = 'box' and coalesce(i.units_per_box, 0) <= 1 and new.pieces_per_pack > 1
                              then new.pieces_per_pack::int else i.units_per_box end,
         updated_at = now()
   where i.id = new.item_id and i.unit_cost is distinct from round(new.list_unit_price, 4);
  perform set_config('app.source_quote_line', '', true);
  return null;
end $$;

create trigger quote_line_push_price after insert or update of list_unit_price, item_id, match_status on public.supplier_quote_lines
for each row execute function public.quote_line_push_price();

revoke execute on function public.latest_quote_line(uuid, uuid) from public, anon;
grant execute on function public.latest_quote_line(uuid, uuid) to authenticated;
revoke execute on function public.items_pull_quote_price() from public, anon, authenticated;
revoke execute on function public.quote_line_push_price() from public, anon, authenticated;
