import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { must, supabase } from '../../../lib/supabase';
import { ErrorMsg, Sheet } from '../../../components/ui';
import { useRoundData, useRounds } from './useQuotes';
import CompareView from './CompareView';
import RequestView from './RequestView';
import UploadView from './UploadView';
import ManualView from './ManualView';

const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

type View = 'compare' | 'request' | 'upload' | 'manual';

export default function QuotesPage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as View) || 'compare';
  const { rounds, loaded, reload } = useRounds();
  const roundId = params.get('round') ?? rounds[0]?.id ?? null;
  const round = rounds.find((r) => r.id === roundId) ?? null;
  const data = useRoundData(roundId);
  const [newRound, setNewRound] = useState(false);

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next);
  };

  useEffect(() => {
    if (loaded && !params.get('round') && rounds[0]) go({ round: rounds[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, rounds]);

  const tabs: [View, string][] = [['compare', 'Compare'], ['request', 'Generate request'], ['upload', 'Upload reply'], ['manual', 'Enter by hand']];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Supplier quotes</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>Ask suppliers for prices, then compare them per piece.</p>
        </div>
        <div className="row">
          <label className="field" style={{ minWidth: 220 }}>
            <span className="lbl">Quote</span>
            <select className="inp" value={roundId ?? ''} onChange={(e) => go({ round: e.target.value })} disabled={!rounds.length}>
              {!rounds.length && <option value="">No quotes yet</option>}
              {rounds.map((r) => <option key={r.id} value={r.id}>{r.label} · {fmtDate(r.opened_at)}</option>)}
            </select>
          </label>
          <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => setNewRound(true)}>New quote</button>
        </div>
      </div>

      <div className="chips" role="tablist" aria-label="Quotes view">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" className="chip" aria-selected={view === k} aria-pressed={view === k} onClick={() => go({ view: k === 'compare' ? null : k })}>{l}</button>
        ))}
      </div>

      {loaded && !rounds.length ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <h2>Start your first quote</h2>
          <p className="muted" style={{ margin: 0 }}>Give it a title, a date and an optional note. Every supplier's prices for it are kept together.</p>
          <button className="btn primary" onClick={() => setNewRound(true)}>New quote</button>
        </div>
      ) : round && (
        <>
          {round.notes && <div className="note" style={{ whiteSpace: 'pre-wrap' }}>{round.notes}</div>}
          <ErrorMsg error={data.error} />
          {view === 'compare' && <CompareView round={round} {...data} />}
          {view === 'request' && <RequestView round={round} quotes={data.quotes} reload={data.reload} />}
          {view === 'upload' && <UploadView round={round} quotes={data.quotes} lines={data.lines} reload={data.reload} onSaved={() => go({ view: null })} />}
          {view === 'manual' && <ManualView round={round} quotes={data.quotes} lines={data.lines} reload={data.reload} onSaved={() => go({ view: null })} />}
        </>
      )}

      {newRound && <NewRound onClose={() => setNewRound(false)} onCreated={async (id) => { await reload(); setNewRound(false); go({ round: id }); }} />}
    </main>
  );
}

function NewRound({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true); setError(null);
    try {
      const r = must(await supabase.from('quote_rounds').insert({ label: label.trim(), opened_at: date, notes: notes.trim() || null }).select('id').single()) as { id: string };
      onCreated(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="New quote" onClose={onClose} foot={<><ErrorMsg error={error} /><button className="btn primary block" disabled={busy || !label.trim() || !date} onClick={create}>{busy ? 'Creating…' : 'Create quote'}</button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
        <div className="field"><label htmlFor="r-label">Title</label><input id="r-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Fittings pricing check" autoFocus /></div>
        <div className="field"><label htmlFor="r-date">Date</label><input id="r-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label htmlFor="r-notes">Note</label><textarea id="r-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></div>
      </div>
    </Sheet>
  );
}
