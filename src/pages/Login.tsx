import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { ErrorMsg } from '../components/ui';

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: name }, emailRedirectTo: window.location.origin },
      });
      if (error) setError(error.message);
      else if (!data.session) setInfo('Check your email to confirm your account, then sign in. The inventory manager assigns your truck.');
    }
    setBusy(false);
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <div>
          <div className="small" style={{ color: '#9fd4cf', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Integrity Water Treatment</div>
          <h1 style={{ fontSize: 30, marginTop: 6 }}>{mode === 'in' ? 'Sign in' : 'Create account'}</h1>
          <div style={{ color: '#c9d1cc', marginTop: 6 }}>Inventory · warehouse and trucks</div>
        </div>
        {mode === 'up' && (
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
          <input id="password" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <ErrorMsg error={error} />
        {info && <div className="ok-msg">{info}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="linkbtn" style={{ color: '#c9d1cc' }} onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); setInfo(null); }}>
          {mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
