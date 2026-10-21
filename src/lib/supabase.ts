import { createClient } from '@supabase/supabase-js';

// Publishable key: safe in the browser. Row-level security and server functions enforce access.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://tcevsrqvdfakyofqebkn.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_jpm3UafnJWx7BAWTE5CWHg_Pn5skxj9';

export const supabase = createClient(url, key);

/** Unwraps a Supabase response, throwing a readable error. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
