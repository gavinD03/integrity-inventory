import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { ErrorMsg } from '../components/ui';

/** Sign in only. Accounts are created by the inventory manager in Settings.
 *  The one exception: if no owner exists yet, the first person sets up the owner account. */
export default function Login() {
  const [hasOwner, setHasOwner] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.functions.invoke('admin-users', { body: { action: 'status' } })
      .then(({ data }) => setHasOwner(data?.hasOwner ?? true))
      .catch(() => setHasOwner(true));
  }, []);

  const setup = hasOwner === false;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    if (setup) {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'bootstrap', email, password, full_name: name },
      });
      if (error || data?.error) {
        setError(data?.error ?? (await readError(error)));
        setBusy(false);
        return;
      }
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) setError(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
    setBusy(false);
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <div>
          <div className="small" style={{ color: '#9fd4cf', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Integrity Water Treatment</div>
          <h1 style={{ fontSize: 30, marginTop: 6 }}>{setup ? 'Set up the owner account' : 'Sign in'}</h1>
          <div style={{ color: '#c9d1cc', marginTop: 6 }}>
            {setup ? 'First-time setup. You can add everyone else from Settings.' : 'Your account is created by the inventory manager.'}
          </div>
        </div>
        {setup && (
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <ErrorMsg error={error} />
        <button className="btn primary block" disabled={busy || hasOwner === null}>{busy ? 'Working…' : setup ? 'Create owner account' : 'Sign in'}</button>
        {!setup && <div className="small" style={{ color: '#c9d1cc' }}>Forgot your password? Ask the inventory manager to reset it.</div>}
      </form>
    </div>
  );
}

async function readError(err: unknown): Promise<string> {
  const ctx = (err as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try { const j = await ctx.json(); if (j?.error) return j.error; } catch { /* ignore */ }
  }
  return (err as Error)?.message ?? 'Something went wrong';
}
