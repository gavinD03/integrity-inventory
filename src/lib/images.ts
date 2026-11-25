import { must, supabase } from './supabase';

const BUCKET = 'item-images';

/** Public URL for an item photo (or null). */
export function imageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Shrinks a phone photo to at most `max` px on its long side as JPEG, so uploads are small and load fast on trucks. */
async function shrink(file: File, max = 1000): Promise<Blob> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), 'image/jpeg', 0.82));
}

/** Uploads a photo for an item, points the item at it, and removes the old one. */
export async function setItemImage(itemId: string, file: File, oldPath: string | null): Promise<string> {
  const blob = await shrink(file);
  const path = `${itemId}/${Date.now()}.jpg`;
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
  if (up.error) throw new Error(up.error.message);
  must(await supabase.from('items').update({ image_path: path }).eq('id', itemId).select('id'));
  if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath]);
  return path;
}

export async function clearItemImage(itemId: string, oldPath: string | null) {
  must(await supabase.from('items').update({ image_path: null }).eq('id', itemId).select('id'));
  if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath]);
}
