import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { must, supabase } from '../../../lib/supabase';
import { ErrorMsg, Sheet } from '../../../components/ui';
import { useRoundData, useRounds } from './useQuotes';
import CompareView from './CompareView';
import RequestView from './RequestView';
import UploadView from './UploadView';
import ManualView from './ManualView';

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
          <p className="muted" style={{ margin: '6px 0 0' }}>January: full list. July: top items by spend. All prices compared per piece.</p>
        </div>
        <div className="row">
          <label className="field" style={{ minWidth: 220 }}>
            <span className="lbl">Round</span>
            <select className="inp" value={roundId ?? ''} onChange={(e) => go({ round: e.target.value })} disabled={!rounds.length}>
              {!rounds.length && <option value="">No rounds yet</option>}
              {rounds.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => setNewRound(true)}>New round</button>
        </div>
      </div>

      <div className="chips" role="tablist" aria-label="Quotes view">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" className="chip" aria-selected={view === k} aria-pressed={view === k} onClick={() => go({ view: k === 'compare' ? null : k })}>{l}</button>
        ))}
      </div>

      {loaded && !rounds.length ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <h2>Start your first quote round</h2>
          <p className="muted" style={{ margin: 0 }}>A round groups every supplier's quote for one period, e.g. "2027-01 Full".</p>
          <button className="btn primary" onClick={() => setNewRound(true)}>New round</button>
        </div>
      ) : round && (
        <>
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
  const now = new Date();
  const july = now.getMonth() >= 3 && now.getMonth() <= 8;
  const nextYear = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
  const [kind, setKind] = useState<'full' | 'top'>(july ? 'top' : 'full');
  const [label, setLabel] = useState(july ? `${now.getFullYear()}-07 Top items` : `${nextYear}-01 Full`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true); setError(null);
    try {
      const r = must(await supabase.from('quote_rounds').insert({ label: label.trim(), kind }).select('id').single()) as { id: string };
      onCreated(r.id);
    } catch (e) {
      const m = (e as Error).message;
      setError(/duplicate|unique/i.test(m) ? 'A round with that label already exists.' : m);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="New quote round" onClose={onClose} foot={<><ErrorMsg error={error} /><button className="btn primary block" disabled={busy || !label.trim()} onClick={create}>{busy ? 'Creating…' : 'Create round'}</button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
        <div className="chips">
          <button className="chip" aria-pressed={kind === 'full'} onClick={() => setKind('full')}>Full list (January)</button>
          <button className="chip" aria-pressed={kind === 'top'} onClick={() => setKind('top')}>Top items (July)</button>
        </div>
        <div className="field"><label htmlFor="r-label">Label</label><input id="r-label" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
      </div>
    </Sheet>
  );
}
