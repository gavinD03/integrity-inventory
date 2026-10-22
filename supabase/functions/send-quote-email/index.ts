// Emails a quote request (Excel + PDF attached) to a supplier from the manager's Gmail.
// Secrets (Supabase → Edge Functions → Secrets): GMAIL_USER, GMAIL_APP_PASSWORD (a Google "app password", not the normal password).
// Gmail SMTP on port 465 (Supabase blocks outbound 25 and 587). Gmail keeps a copy in the account's Sent folder.
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
const splitList = (v: unknown) => String(v ?? '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: 'Not signed in' }, 401);
  const { data: me } = await admin.from('profiles').select('role, active, full_name').eq('id', userData.user.id).single();
  if (!me || !me.active || !['manager', 'owner'].includes(me.role)) return json({ error: 'Only the inventory manager can email suppliers' }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const user = Deno.env.get('GMAIL_USER');
  const pass = Deno.env.get('GMAIL_APP_PASSWORD');
  if (body.action === 'status') return json({ configured: !!(user && pass), from: user ?? null });
  if (!user || !pass) return json({ error: 'Email isn’t set up yet. Add GMAIL_USER and GMAIL_APP_PASSWORD in Supabase.', code: 'not_configured' }, 400);

  const to = splitList(body.to);
  const cc = splitList(body.cc);
  if (!to.length) return json({ error: 'Add the supplier’s email address' }, 400);
  const bad = [...to, ...cc].find((e) => !EMAIL.test(e));
  if (bad) return json({ error: `“${bad}” isn’t a valid email address` }, 400);
  const subject = String(body.subject ?? '').trim();
  const message = String(body.message ?? '').trim();
  if (!subject) return json({ error: 'Add a subject' }, 400);

  const quoteId = String(body.quote_id ?? '');
  const { data: quote } = await admin.from('supplier_quotes').select('id').eq('id', quoteId).maybeSingle();
  if (!quote) return json({ error: 'Generate the request first' }, 400);

  const files = Array.isArray(body.attachments) ? body.attachments as { filename: string; base64: string; type?: string }[] : [];
  if (!files.length || files.length > 4) return json({ error: 'Attachments missing' }, 400);
  const total = files.reduce((n, f) => n + String(f.base64 ?? '').length, 0);
  if (total > 10_000_000) return json({ error: 'Attachments are too large to email' }, 400);

  const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
  try {
    await transport.sendMail({
      from: me.full_name ? `"${String(me.full_name).replace(/"/g, '')}" <${user}>` : user,
      to, cc: cc.length ? cc : undefined,
      replyTo: user,
      subject,
      text: message,
      attachments: files.map((f) => ({ filename: String(f.filename), content: String(f.base64), encoding: 'base64', contentType: f.type })),
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (/535|Username and Password not accepted|BadCredentials/i.test(msg)) {
      return json({ error: 'Gmail rejected the sign-in. Check GMAIL_USER and that GMAIL_APP_PASSWORD is a Google app password (16 letters), not your normal password.' }, 400);
    }
    return json({ error: `Couldn’t send: ${msg}` }, 502);
  }

  await admin.from('supplier_quotes').update({ emailed_at: new Date().toISOString(), emailed_to: [...to, ...cc].join(', ') }).eq('id', quoteId);
  return json({ ok: true, to, cc });
});
