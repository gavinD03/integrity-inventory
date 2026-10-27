// Account management for Integrity Inventory. Accounts are created here (never by public sign-up),
// with email pre-confirmed so nobody has to verify an email.
//
// Actions:
//   status     (no auth)                → { hasOwner }
//   bootstrap  (no auth, only if no owner exists) → creates the first owner
//   create     (manager/owner)          → creates a person with a temporary password
//   set_password (manager/owner)        → resets a person's password
//   set_active (manager/owner)          → disables or re-enables sign-in
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const ROLES = ['tech', 'manager', 'owner'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const action = String(body.action ?? '');

  const ownerCount = async () => {
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'owner');
    return count ?? 0;
  };

  const validEmail = (e: unknown) => typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());
  const validPassword = (p: unknown) => typeof p === 'string' && p.length >= 8;

  if (action === 'status') return json({ hasOwner: (await ownerCount()) > 0 });

  if (action === 'bootstrap') {
    if ((await ownerCount()) > 0) return json({ error: 'An owner already exists. Ask them to create your account.' }, 403);
    if (!validEmail(body.email)) return json({ error: 'Enter a valid email' }, 400);
    if (!validPassword(body.password)) return json({ error: 'Password must be at least 8 characters' }, 400);
    const { error } = await admin.auth.admin.createUser({
      email: String(body.email).trim().toLowerCase(),
      password: String(body.password),
      email_confirm: true,
      user_metadata: { full_name: String(body.full_name ?? '').trim() },
      app_metadata: { created_via: 'admin', role: 'owner' },
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  // Everything else requires a signed-in manager or owner.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: 'Not signed in' }, 401);
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', userData.user.id).single();
  if (!me || !me.active || !['manager', 'owner'].includes(me.role)) return json({ error: 'Only the inventory manager can manage accounts' }, 403);

  const targetRole = async (id: string) => {
    const { data } = await admin.from('profiles').select('role').eq('id', id).single();
    return data?.role as string | undefined;
  };

  if (action === 'create') {
    const role = String(body.role ?? 'tech');
    if (!ROLES.includes(role)) return json({ error: 'Invalid role' }, 400);
    if (role === 'owner' && me.role !== 'owner') return json({ error: 'Only an owner can create owner accounts' }, 403);
    if (!validEmail(body.email)) return json({ error: 'Enter a valid email' }, 400);
    if (!validPassword(body.password)) return json({ error: 'Temporary password must be at least 8 characters' }, 400);
    if (!String(body.full_name ?? '').trim()) return json({ error: 'Enter a name' }, 400);
    const email = String(body.email).trim().toLowerCase();
    const truck = body.truck_id ? String(body.truck_id) : null;
    // Pre-approve this email; the database only accepts accounts with a fresh approval.
    const { error: pendErr } = await admin.from('pending_accounts').insert({ email, role, truck_id: truck, full_name: String(body.full_name).trim() });
    if (pendErr) return json({ error: pendErr.message }, 400);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: String(body.password),
      email_confirm: true,
      user_metadata: { full_name: String(body.full_name).trim() },
      app_metadata: { created_via: 'admin', role, truck_id: body.truck_id ? String(body.truck_id) : '' },
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, id: data.user?.id });
  }

  if (action === 'set_password') {
    const id = String(body.user_id ?? '');
    if (!validPassword(body.password)) return json({ error: 'Password must be at least 8 characters' }, 400);
    const tr = await targetRole(id);
    if (!tr) return json({ error: 'User not found' }, 404);
    if (tr === 'owner' && me.role !== 'owner') return json({ error: 'Only an owner can reset an owner password' }, 403);
    const { error } = await admin.auth.admin.updateUserById(id, { password: String(body.password) });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === 'set_active') {
    const id = String(body.user_id ?? '');
    const active = !!body.active;
    if (id === userData.user.id) return json({ error: "You can't disable your own account" }, 400);
    const tr = await targetRole(id);
    if (!tr) return json({ error: 'User not found' }, 404);
    if (tr === 'owner' && me.role !== 'owner') return json({ error: 'Only an owner can change an owner account' }, 403);
    const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
    if (error) return json({ error: error.message }, 400);
    await admin.from('profiles').update({ active }).eq('id', id);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});
