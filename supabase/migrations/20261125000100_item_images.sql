-- Product photos: items.image_path points into the public "item-images" bucket. Only managers/owners can upload, replace or remove.
alter table public.items add column if not exists image_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-images', 'item-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "item images: managers upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'item-images' and (select public.is_manager()));
create policy "item images: managers replace" on storage.objects for update to authenticated
  using (bucket_id = 'item-images' and (select public.is_manager()));
create policy "item images: managers remove" on storage.objects for delete to authenticated
  using (bucket_id = 'item-images' and (select public.is_manager()));
