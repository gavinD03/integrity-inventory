import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { must, supabase } from '../../lib/supabase';
import { ticketCode } from '../../lib/format';
import { ErrorMsg, Stepper } from '../../components/ui';

interface Line { item_id: string; qty: number; serial: string }

export default function CloseJob() {
  const { me, isManager, items, kits, trucks, qty, itemById, refresh, locName } = useData();
  const [params] = useSearchParams();
  const truckId = isManager ? params.get('truck') ?? trucks[0]?.id ?? null : me.truck_id;
  const [jobRef, setJobRef] = useState('');
  const [kitId, setKitId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [addId, setAddId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const usable = items.filter((i) => i.mode === 'each');

  function applyKit(id: string) {
    setKitId(id);
    const kit = kits.find((k) => k.id === id);
    if (!kit) return;
    setLines(kit.kit_items.map((k) => ({ item_id: k.item_id, qty: Number(k.qty), serial: '' })));
  }

  function addLine() {
    if (!addId || lines.some((l) => l.item_id === addId)) return;
    setLines([...lines, { item_id: addId, qty: 1, serial: '' }]);
    setAddId('');
  }

  const active = lines.filter((l) => l.qty > 0);
  const missingSerial = active.some((l) => itemById(l.item_id)?.serial_tracked && !l.serial.trim());
  const total = active.reduce((t, l) => t + l.qty, 0);

  async function submit() {
    if (!truckId) return;
    setBusy(true); setError(null);
    try {
      const res = must(await supabase.rpc('submit_ticket', {
        p_type: 'job', p_from: truckId, p_to: null, p_job_ref: jobRef,
        p_lines: active.map((l) => ({ item_id: l.item_id, qty: l.qty, serial: l.serial })),
      })) as { number: number };
      setDone(ticketCode({ type: 'job', number: res.number }));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const back = isManager ? '/truck' : '/';

  if (done) {
    return (
      <div className="tech">
        <div className="tech-head"><div style={{ fontSize: 24, fontWeight: 700 }}>Job closed</div></div>
        <div className="tech-body" style={{ gap: 12 }}>
          <div className="mono" style={{ fontSize: 20, color: 'var(--accent)' }}>{done}</div>
          <div className="ok-msg">{total} {total === 1 ? 'part' : 'parts'} deducted from {locName(truckId)}. Serial numbers are linked to this job.</div>
          <Link className="btn dark block" to={back}>Back to my truck</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="tech">
      <div className="tech-head">
        <Link to={back} style={{ color: 'var(--on-dark-2)', fontSize: 14 }}>← My truck</Link>
        <div style={{ fontSize: 24, fontWeight: 700 }}>Confirm parts used</div>
        <div className="sub">{locName(truckId)} · parts come off your truck</div>
      </div>
      <div className="tech-body" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="job">Job # or customer</label>
          <input id="job" value={jobRef} onChange={(e) => setJobRef(e.target.value)} placeholder="e.g. 1042 – Smith" />
        </div>

        {kits.length > 0 && (
          <div className="field">
            <div className="lbl">Start from a kit</div>
            <div className="chips">
              {kits.map((k) => (
                <button key={k.id} className="chip" aria-pressed={kitId === k.id} onClick={() => applyKit(k.id)}>{k.name}</button>
              ))}
            </div>
          </div>
        )}

        {lines.map((l, idx) => {
          const it = itemById(l.item_id);
          if (!it) return null;
          return (
            <div key={l.item_id} className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{it.name}</div>
                  <div className="small muted">On truck: {qty(it.id, truckId)}{it.strategy === 'job' ? ' · bought for this job' : ''}</div>
                </div>
                <Stepper value={l.qty} onChange={(v) => setLines(lines.map((x, i) => (i === idx ? { ...x, qty: v } : x)))} />
              </div>
              {it.serial_tracked && l.qty > 0 && (
                <div className="field">
                  <label htmlFor={`sn-${l.item_id}`}>Serial number{l.qty > 1 ? 's (comma-separated)' : ''} · required</label>
                  <input id={`sn-${l.item_id}`} className="mono" autoComplete="off" value={l.serial} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, serial: e.target.value } : x)))} />
                </div>
              )}
            </div>
          );
        })}

        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <select className="inp" aria-label="Add a part" value={addId} onChange={(e) => setAddId(e.target.value)} style={{ flex: 1 }}>
            <option value="">Add a part…</option>
            {usable.filter((i) => !lines.some((l) => l.item_id === i.id)).map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          <button className="btn" onClick={addLine} disabled={!addId}>Add</button>
        </div>
        <div className="small muted">Fittings aren't entered here; they're counted when boxes are loaded.</div>
      </div>
      <div className="tech-foot">
        <ErrorMsg error={error} />
        <button className="btn primary block" disabled={busy || total === 0 || missingSerial} onClick={submit}>
          {missingSerial ? 'Enter serial numbers to complete' : total === 0 ? 'Add parts used' : busy ? 'Submitting…' : `Complete job · deduct ${total} ${total === 1 ? 'part' : 'parts'}`}
        </button>
      </div>
    </div>
  );
}
