import { supabase } from './supabase';

/** Calls the admin-users edge function and throws a readable error. */
export async function adminUsers(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
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
