-- Standard lead time per supplier.
--  • Setting an item's supplier also sets its lead time to the supplier's standard (unless typed in the same save).
--  • Changing a supplier's standard updates its items that were on the old standard (custom lead times are kept).
alter table public.suppliers add column if not exists lead_days integer check (lead_days >= 0);

create or replace function public.items_pull_quote_price() returns trigger
language plpgsql security definer set search_path = public as $$
declare l public.supplier_quote_lines%rowtype; v_lead int; v_name text;
begin
  if new.supplier_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.supplier_id is not distinct from old.supplier_id then return new; end if;

  select name, lead_days into v_name, v_lead from public.suppliers where id = new.supplier_id;
  new.supplier := v_name;
  if v_lead is not null and (tg_op = 'INSERT' or new.lead_days is not distinct from old.lead_days) then
    new.lead_days := v_lead;
  end if;

  if tg_op = 'UPDATE' and new.unit_cost is distinct from old.unit_cost then return new; end if; -- price typed by hand wins
  if tg_op = 'INSERT' and coalesce(new.unit_cost, 0) > 0 then return new; end if;
  l := public.latest_quote_line(new.id, new.supplier_id);
  if l.id is null then return new; end if;
  perform set_config('app.source_quote_line', l.id::text, true);
  new.unit_cost := round(l.list_unit_price, 4);
  if new.mode = 'box' and coalesce(new.units_per_box, 0) <= 1 and l.pieces_per_pack > 1 then
    new.units_per_box := l.pieces_per_pack::int;
  end if;
  return new;
end $$;

create or replace function public.suppliers_push_lead_time() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lead_days is null or new.lead_days is not distinct from old.lead_days then return null; end if;
  update public.items
     set lead_days = new.lead_days, updated_at = now()
   where supplier_id = new.id and (old.lead_days is null or lead_days = old.lead_days);
  return null;
end $$;

create trigger suppliers_push_lead_time after update of lead_days on public.suppliers
for each row execute function public.suppliers_push_lead_time();

revoke execute on function public.suppliers_push_lead_time() from public, anon, authenticated;
