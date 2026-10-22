import { useEffect, useState } from 'react';
import { useData } from '../lib/data';
import { must, supabase } from '../lib/supabase';
import { learnCodes, SEGMENT_LABEL, SEGMENTS, type LearnedCode } from '../lib/sku';
import type { SkuSegment } from '../lib/types';
import { AddCode } from './SkuBuilder';
import { ErrorMsg, Sheet } from './ui';

export default function SkuCodesSettings() {
  const { skuCodes, refresh } = useData();
  const [seg, setSeg] = useState<SkuSegment>('category');
  const [adding, setAdding] = useState(false);
  const [learning, setLearning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = skuCodes.filter((c) => c.segment === seg).sort((a, b) => a.code.localeCompare(b.code));
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>SKU codes</h2>
        <button className="btn sm" onClick={() => setLearning(true)}>Learn codes from existing SKUs</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Format CATEGORY-MATERIAL-ITEM-SIZE, e.g. FIT-PVC-E90-100. These feed the dropdowns on the item screen.</p>
      <div className="chips">
        {SEGMENTS.map((s) => <button key={s} className="chip" aria-pressed={seg === s} onClick={() => setSeg(s)}>{SEGMENT_LABEL[s]} · {skuCodes.filter((c) => c.segment === s).length}</button>)}
      </div>
      <ErrorMsg error={error} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
        {list.map((c) => (
          <div key={c.id} className="row" style={{ flexWrap: 'nowrap', opacity: c.active ? 1 : 0.55 }}>
            <span className="mono" style={{ width: 70 }}>{c.code}</span>
            <input className="inp" aria-label={`Meaning of ${c.code}`} defaultValue={c.label}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.label && run(async () => { must(await supabase.from('sku_codes').update({ label: e.target.value.trim() }).eq('id', c.id).select('id')); })} />
            <button className="btn sm" onClick={() => run(async () => { must(await supabase.from('sku_codes').update({ active: !c.active }).eq('id', c.id).select('id')); })}>{c.active ? 'Hide' : 'Show'}</button>
          </div>
        ))}
      </div>
      <div><button className="btn sm" onClick={() => setAdding(true)}>+ Add {SEGMENT_LABEL[seg].toLowerCase()} code</button></div>
      {adding && <AddCode segment={seg} onClose={() => setAdding(false)} onAdded={() => setAdding(false)} />}
      {learning && <Learn onClose={() => setLearning(false)} />}
    </section>
  );
}

/** Finds codes used in existing SKUs that aren't in the list yet. Segments are guesses; review before saving. */
function Learn({ onClose }: { onClose: () => void }) {
  const { skuCodes, refresh } = useData();
  const [rows, setRows] = useState<(LearnedCode & { label: string; keep: boolean })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('items').select('sku').not('sku', 'is', null).then(({ data, error }) => {
      if (error) { setError(error.message); setRows([]); return; }
      const skus = ((data as { sku: string }[]) ?? []).map((r) => r.sku);
      setRows(learnCodes(skus, skuCodes).map((l) => ({ ...l, label: '', keep: true })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!rows) return;
    const chosen = rows.filter((r) => r.keep);
    const missing = chosen.filter((r) => !r.label.trim());
    if (missing.length) { setError(`Add what ${missing.map((m) => m.code).join(', ')} mean${missing.length === 1 ? 's' : ''}, or untick them.`); return; }
    setBusy(true); setError(null);
    try {
      if (chosen.length) must(await supabase.from('sku_codes').insert(chosen.map((r) => ({ segment: r.segment, code: r.code, label: r.label.trim() }))).select('id'));
      await refresh();
      setDone(`Added ${chosen.length} codes.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Learn codes from existing SKUs" sub="Segments are guessed from position and known codes. Fix any wrong guesses before saving." onClose={onClose}
      foot={done ? <button className="btn dark block" onClick={onClose}>Done</button> : <><ErrorMsg error={error} /><button className="btn primary block" disabled={busy || !rows?.some((r) => r.keep)} onClick={save}>{busy ? 'Saving…' : `Add ${rows?.filter((r) => r.keep).length ?? 0} codes`}</button></>}>
      {done ? <div className="ok-msg" style={{ margin: '8px 0' }}>{done}</div> : rows === null ? <div className="muted" style={{ padding: 12 }}>Reading SKUs…</div> : rows.length === 0 ? <div className="muted" style={{ padding: 12 }}>Every code in your SKUs is already in the list.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 0' }}>
          {rows.map((r, i) => (
            <div key={`${r.segment}:${r.code}`} className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
              <input type="checkbox" aria-label={`Add ${r.code}`} checked={r.keep} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} style={{ width: 18, height: 18 }} />
              <span className="mono" style={{ width: 64 }}>{r.code}</span>
              <select className="inp" aria-label={`Segment for ${r.code}`} value={r.segment} style={{ width: 120 }} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, segment: e.target.value as SkuSegment } : x)))}>
                {SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}
              </select>
              <input className="inp" aria-label={`Meaning of ${r.code}`} placeholder={`e.g. from ${r.fromSkus[0]}`} value={r.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
