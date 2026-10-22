-- Re-requests and re-uploads replace in place: previous lines are cleared (prices nulled, requested flag reset)
-- rather than removed, so price_change_log references stay intact.
create or replace function public.create_quote_request(p_round uuid, p_supplier uuid, p_items uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_q public.supplier_quotes%rowtype; v_n int;
begin
  if not public.is_manager() then raise exception 'Managers only'; end if;
  if p_items is null or cardinality(p_items) = 0 then raise exception 'Select at least one item'; end if;
  select * into v_q from public.supplier_quotes where round_id = p_round and supplier_id = p_supplier for update;
  if found and v_q.status = 'saved' then
    raise exception 'This supplier already has a saved quote for this round';
  end if;
  if found then
    update public.supplier_quotes set status = 'requested', requested_at = now() where id = v_q.id;
    update public.supplier_quote_lines set requested = false where quote_id = v_q.id;
  else
    insert into public.supplier_quotes (round_id, supplier_id, status, requested_at)
    values (p_round, p_supplier, 'requested', now()) returning * into v_q;
  end if;
  update public.supplier_quote_lines l set requested = true, sku_raw = i.sku, description_raw = i.name, match_status = 'matched'
    from public.items i
   where l.quote_id = v_q.id and l.item_id = i.id and i.id = any (p_items);
  insert into public.supplier_quote_lines (quote_id, item_id, requested, sku_raw, description_raw, match_status)
  select v_q.id, i.id, true, i.sku, i.name, 'matched'
    from public.items i
   where i.id = any (p_items)
     and not exists (select 1 from public.supplier_quote_lines l where l.quote_id = v_q.id and l.item_id = i.id);
  select count(*) into v_n from public.supplier_quote_lines where quote_id = v_q.id and requested;
  return jsonb_build_object('quote_id', v_q.id, 'lines', v_n);
end $$;

create or replace function public.save_quote(p_round uuid, p_supplier uuid, p_file_name text, p_lines jsonb, p_status text default 'saved')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_q uuid; v_l jsonb; v_item uuid; v_existing uuid; v_n int := 0; v_sku text;
begin
  if not public.is_manager() then raise exception 'Managers only'; end if;
  if p_status not in ('draft','saved') then raise exception 'Bad status'; end if;
  insert into public.supplier_quotes (round_id, supplier_id, file_name, status, uploaded_at, uploaded_by)
  values (p_round, p_supplier, p_file_name, p_status, now(), auth.uid())
  on conflict (round_id, supplier_id) do update
    set file_name = coalesce(excluded.file_name, public.supplier_quotes.file_name),
        status = excluded.status, uploaded_at = now(), uploaded_by = auth.uid()
  returning id into v_q;

  -- Clear previous answers. Unrequested leftovers become 'ignored' until reused below.
  update public.supplier_quote_lines
     set pieces_per_pack = null, list_pack_price = null, bulk_qty = null, bulk_unit_price = null, notes = null,
         match_status = case when requested then 'matched' else 'ignored' end
   where quote_id = v_q;

  for v_l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_item := nullif(v_l->>'item_id', '')::uuid;
    v_sku := nullif(trim(v_l->>'sku_raw'), '');
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
        item_id = v_item,
        pieces_per_pack = nullif(v_l->>'pieces_per_pack', '')::numeric,
        list_pack_price = nullif(v_l->>'list_pack_price', '')::numeric,
        bulk_qty = nullif(v_l->>'bulk_qty', '')::numeric,
        bulk_unit_price = nullif(v_l->>'bulk_unit_price', '')::numeric,
        notes = nullif(v_l->>'notes', ''),
        sku_raw = coalesce(v_sku, sku_raw),
        description_raw = coalesce(nullif(v_l->>'description_raw', ''), description_raw),
        match_status = coalesce(nullif(v_l->>'match_status', ''), case when v_item is null then 'unmatched' else 'matched' end)
      where id = v_existing;
    else
      insert into public.supplier_quote_lines
        (quote_id, item_id, requested, sku_raw, description_raw, pieces_per_pack, list_pack_price, bulk_qty, bulk_unit_price, notes, match_status)
      values (v_q, v_item, false, v_sku, nullif(v_l->>'description_raw', ''),
        nullif(v_l->>'pieces_per_pack', '')::numeric, nullif(v_l->>'list_pack_price', '')::numeric,
        nullif(v_l->>'bulk_qty', '')::numeric, nullif(v_l->>'bulk_unit_price', '')::numeric,
        nullif(v_l->>'notes', ''),
        coalesce(nullif(v_l->>'match_status', ''), case when v_item is null then 'unmatched' else 'matched' end));
    end if;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('quote_id', v_q, 'lines', v_n);
end $$;

revoke execute on function public.create_quote_request(uuid, uuid, uuid[]) from public, anon;
revoke execute on function public.save_quote(uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function public.create_quote_request(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.save_quote(uuid, uuid, text, jsonb, text) to authenticated;
