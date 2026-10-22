-- SKU generation, barcode labels, manufacturer barcodes (UPCs), returns.
-- (20261022000400: alter type public.ticket_type add value 'return' — must run in its own transaction.)

-- ── SKU code segments ──────────────────────────────────────────────────────
create table public.sku_codes (
  id uuid primary key default gen_random_uuid(),
  segment text not null check (segment in ('category','material','item','size')),
  code text not null check (code ~ '^[A-Z0-9]+$'),
  label text not null,
  active boolean not null default true,
  unique (segment, code)
);

insert into public.sku_codes (segment, code, label) values
  ('category','FIT','Fittings'), ('category','PIP','Pipe'), ('category','VLV','Valves'), ('category','WEL','Well'),
  ('category','CON','Consumables'), ('category','WH','Water heater'), ('category','SFT','Softener service'),
  ('category','MED','Media'), ('category','SPC','Specialty'),
  ('material','PVC','PVC'), ('material','CPV','CPVC'), ('material','SHB','SharkBite'), ('material','TRN','PVC-to-CPVC transition'),
  ('material','GAL','Galvanized'), ('material','CLK','Clack'), ('material','STN','Stenner'), ('material','PMP','Pump'),
  ('material','TNK','Tank'), ('material','PSW','Pressure switch'), ('material','GEN','Generic'),
  ('item','E90','90° elbow'), ('item','CPL','Coupling'), ('item','TEE','Tee'), ('item','MAD','Male adapter'),
  ('item','FAD','Female adapter'), ('item','UNI','Union'), ('item','RAD','Reducing adapter'), ('item','RBU','Reducing bushing'),
  ('item','BSH','Bushing'), ('item','DSC','Deep socket coupling'), ('item','BAL','Ball valve'), ('item','CHK','Check valve'),
  ('item','NIP','Nipple'), ('item','STE','Street tee'),
  ('size','025','1/4"'), ('size','038','3/8"'), ('size','050','1/2"'), ('size','075','3/4"'), ('size','100','1"'), ('size','125','1-1/4"');

alter table public.sku_codes enable row level security;
create policy "read codes" on public.sku_codes for select to authenticated using (true);
create policy "manage codes" on public.sku_codes for all to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));

-- ── SKU lock ───────────────────────────────────────────────────────────────
alter table public.items add column if not exists sku_locked boolean not null default false;
alter table public.items add column if not exists label_printed_at timestamptz;

-- Normalize SKUs (uppercase, A-Z 0-9 and dashes) so every Code 128 label scans back exactly; block edits once locked.
create or replace function public.items_sku_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.sku := nullif(upper(trim(new.sku)), '');
  if new.sku is not null and new.sku !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' then
    raise exception 'SKU "%" can only use letters, numbers and single dashes', new.sku;
  end if;
  if tg_op = 'UPDATE' then
    if old.sku_locked then new.sku_locked := true; end if;
    if old.sku_locked and old.sku is not null and new.sku is distinct from old.sku then
      raise exception 'SKU % is locked (it has ticket history or a printed label). Deactivate this item and create a new one instead.', old.sku;
    end if;
    if new.sku is not null and not new.sku_locked
       and (new.label_printed_at is not null or exists (select 1 from public.ticket_lines where item_id = new.id)) then
      new.sku_locked := true;
    end if;
  end if;
  return new;
end $$;
create trigger items_sku_guard before insert or update on public.items
for each row execute function public.items_sku_guard();

create or replace function public.lock_sku_on_ticket() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.items set sku_locked = true where id = new.item_id and sku is not null and not sku_locked;
  return new;
end $$;
create trigger ticket_lines_lock_sku after insert on public.ticket_lines
for each row execute function public.lock_sku_on_ticket();

update public.items i set sku_locked = true
 where i.sku is not null and not i.sku_locked and exists (select 1 from public.ticket_lines l where l.item_id = i.id);

-- ── Manufacturer barcodes ──────────────────────────────────────────────────
create table public.item_barcodes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  code text not null unique,
  pieces_per_scan numeric not null default 1 check (pieces_per_scan > 0),
  label text,
  linked_by uuid references public.profiles(id) default auth.uid(),
  linked_at timestamptz not null default now()
);
create index on public.item_barcodes (item_id);
create index on public.item_barcodes (linked_by);
alter table public.item_barcodes enable row level security;
create policy "read barcodes" on public.item_barcodes for select to authenticated using (true);
create policy "manage barcodes" on public.item_barcodes for all to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));

create or replace function public.link_barcode(p_item uuid, p_code text, p_pieces numeric default null, p_label text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_code text := trim(p_code); v_item public.items%rowtype; v_other record; v_id uuid;
begin
  if not public.is_manager() then raise exception 'Only the inventory manager can link barcodes'; end if;
  if v_code is null or v_code = '' then raise exception 'Scan or type a barcode'; end if;
  select * into v_item from public.items where id = p_item;
  if not found then raise exception 'Item not found'; end if;
  select id, name, sku into v_other from public.items where lower(sku) = lower(v_code) limit 1;
  if found then
    raise exception '% is the IWT label for % — it already scans without linking', upper(v_code), v_other.name;
  end if;
  select i.name, i.sku, b.item_id into v_other from public.item_barcodes b join public.items i on i.id = b.item_id where b.code = v_code;
  if found and v_other.item_id <> p_item then
    raise exception 'Barcode % is already linked to % (%)', v_code, v_other.name, coalesce(v_other.sku, 'no SKU');
  end if;
  insert into public.item_barcodes (item_id, code, pieces_per_scan, label)
  values (p_item, v_code,
          coalesce(p_pieces, case when v_item.mode = 'box' then nullif(v_item.units_per_box, 0) end, 1),
          nullif(trim(p_label), ''))
  on conflict (code) do update set pieces_per_scan = excluded.pieces_per_scan, label = excluded.label
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.mark_labels_printed(p_items uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_manager() then raise exception 'Only the inventory manager can print labels'; end if;
  update public.items set label_printed_at = now(), sku_locked = true where id = any (p_items) and sku is not null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Returns: truck → warehouse ─────────────────────────────────────────────
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

  if p_type = 'return' then
    if p_from is null or not exists (select 1 from public.locations where id = p_from and kind = 'truck') then
      raise exception 'Returns come from a truck';
    end if;
    if p_to is null or not exists (select 1 from public.locations where id = p_to and kind = 'warehouse') then
      raise exception 'Returns go to the warehouse';
    end if;
    if v_role = 'tech' and p_from is distinct from v_truck then raise exception 'You can only return from your own truck'; end if;
  elsif v_role = 'tech' then
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
    if not v_item.active then raise exception '% is inactive', v_item.name; end if;
    if p_type = 'job' and v_item.serial_tracked and coalesce(trim(v_line->>'serial'), '') = '' then
      raise exception 'Serial number required for %', v_item.name;
    end if;
    insert into public.ticket_lines (ticket_id, item_id, qty, serial)
    values (v_id, v_item.id, v_qty, nullif(trim(v_line->>'serial'), ''));
  end loop;

  return jsonb_build_object('id', v_id, 'number', v_num, 'status', v_status);
end $$;

revoke execute on function public.items_sku_guard() from public, anon, authenticated;
revoke execute on function public.lock_sku_on_ticket() from public, anon, authenticated;
revoke execute on function public.link_barcode(uuid, text, numeric, text) from public, anon;
revoke execute on function public.mark_labels_printed(uuid[]) from public, anon;
grant execute on function public.link_barcode(uuid, text, numeric, text) to authenticated;
grant execute on function public.mark_labels_printed(uuid[]) to authenticated;
