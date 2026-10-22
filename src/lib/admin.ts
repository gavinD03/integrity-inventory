import { supabase } from './supabase';

/** Calls an edge function and throws a readable error. */
export async function callFunction(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (data?.error) throw new Error(data.error);
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const j = await ctx.json(); if (j?.error) throw new Error(j.error); } catch (e) { if (e instanceof Error && e.message) throw e; }
    }
    throw new Error(error.message);
  }
  return data ?? {};
}

/** Calls the admin-users edge function and throws a readable error. */
export const adminUsers = (body: Record<string, unknown>) => callFunction('admin-users', body);

/** Base64 of a Blob (for email attachments). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
