import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { ErrorMsg, Sheet } from './ui';

export default function ChangePassword({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    if (pw.length < 8) { setError('Use at least 8 characters'); return; }
    if (pw !== pw2) { setError("Passwords don't match"); return; }
    setBusy(true); setError(null);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setError(error.message);
    else setDone(true);
  }

  return (
    <Sheet
      title="Change password"
      onClose={onClose}
      foot={done
        ? <button className="btn dark block" onClick={onClose}>Done</button>
        : <><ErrorMsg error={error} /><button className="btn primary block" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save new password'}</button></>}
    >
      {done ? <div className="ok-msg" style={{ margin: '8px 0' }}>Password changed.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
          <div className="field"><label htmlFor="pw1">New password</label><input id="pw1" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <div className="field"><label htmlFor="pw2">Repeat new password</label><input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
        </div>
      )}
    </Sheet>
  );
}
