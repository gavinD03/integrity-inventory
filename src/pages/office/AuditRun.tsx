import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { must, supabase } from '../../lib/supabase';
import { money, ticketCode } from '../../lib/format';
import type { Audit, AuditCount, Item, Ticket } from '../../lib/types';
import { ErrorMsg } from '../../components/ui';
import { auditSummary } from './AuditList';

export default function AuditRun() {
  const { id } = useParams();
  const { items, locations, itemById, locName, refresh } = useData();
  const [audit, setAudit] = useState<Audit | null>(null);
  const [counts, setCounts] = useState<AuditCount[]>([]);
  const [adjTickets, setAdjTickets] = useState<Ticket[]>([]);
  const [loc, setLoc] = useState<string>(locations[0]?.id ?? '');
  const [scope, setScope] = useState<'week' | 'all'>('week');
  const [entry, setEntry] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [a, c, t] = await Promise.all([
      supabase.from('audits').select('*').eq('id', id).single(),
      supabase.from('audit_counts').select('*').eq('audit_id', id),
      supabase.from('tickets').select('*, ticket_lines(*)').eq('audit_id', id),
    ]);
    if (a.error) { setError(a.error.message); return; }
    setAudit(a.data as Audit);
    setCounts((c.data as AuditCount[]) ?? []);
    setAdjTickets((t.data as Ticket[]) ?? []);
    setNotes((a.data as Audit).notes ?? '');
    setOrderNote((a.data as Audit).order_note ?? '');
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const location = locations.find((l) => l.id === loc);
  const countFor = (itemId: string, locId: string) => counts.find((c) => c.item_id === itemId && c.location_id === locId);

  const list: Item[] = useMemo(() => {
    if (!audit || !location) return [];
    const base = items.filter((i) => i.strategy === 'stock' && (location.kind === 'warehouse' || i.mode === 'each'));
    if (scope === 'all') return base;
    // Weekly cycle count: Tier 3-4 and critical every week; Tier 1-2 rotate in thirds.
    return base.filter((i, idx) => i.tier >= 3 || i.critical || idx % 3 === audit.number % 3);
  }, [items, location, scope, audit]);

  const cost = (itemId: string) => itemById(itemId)?.unit_cost ?? 0;
  const summary = auditSummary(counts, cost);
  const variances = counts.filter((c) => Number(c.counted) !== Number(c.expected));
  const isOpen = audit?.status === 'open';
  const doneHere = list.filter((i) => countFor(i.id, loc)).length;

  async function saveLocation() {
    if (!audit) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      const toSave = Object.entries(entry).filter(([, v]) => v !== '');
      for (const [itemId, v] of toSave) {
        must(await supabase.rpc('save_count', { p_audit: audit.id, p_item: itemId, p_location: loc, p_counted: Number(v), p_reason: reasons[`${itemId}:${loc}`] ?? null }));
      }
      setEntry({});
      setMsg(`Saved ${toSave.length} counts for ${location?.name}.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveReason(c: AuditCount) {
    const r = reasons[`${c.item_id}:${c.location_id}`];
    if (r == null || !audit) return;
    const { error } = await supabase.rpc('save_count', { p_audit: audit.id, p_item: c.item_id, p_location: c.location_id, p_counted: Number(c.counted), p_reason: r });
    if (error) setError(error.message);
    else await load();
  }

  async function complete() {
    if (!audit) return;
    if (!confirm(`Complete audit #${audit.number}? ${variances.length} differences will post as adjustment tickets.`)) return;
    setBusy(true); setError(null);
    try {
      const res = must(await supabase.rpc('complete_audit', { p_audit: audit.id, p_notes: notes, p_order_note: orderNote })) as { adjustment_tickets: number };
      setMsg(`Audit completed. ${res.adjustment_tickets} adjustment ticket(s) posted.`);
      await Promise.all([load(), refresh()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!audit) return <main className="page"><ErrorMsg error={error} /><p className="muted">Loading…</p></main>;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <Link to="/audits" className="small">← Audits</Link>
          <h1 style={{ marginTop: 4 }}>Audit #{audit.number}</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Started {new Date(audit.started_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            {audit.completed_at && ` · completed ${new Date(audit.completed_at).toLocaleDateString()}`}
          </p>
        </div>
        {isOpen ? <span className="pill amber">Open</span> : <span className="pill ok">Completed</span>}
      </div>

      <ErrorMsg error={error} />
      {msg && <div className="ok-msg">{msg}</div>}

      <div className="stats">
        <div className="stat"><div className="label">Lines counted</div><div className="value">{summary.lines}</div></div>
        <div className="stat"><div className="label">Differences</div><div className={`value ${summary.off ? 'warn' : ''}`}>{summary.off}</div></div>
        <div className="stat"><div className="label">Variance (by value)</div><div className="value">{summary.lines ? `${summary.variancePct.toFixed(1)}%` : '—'}</div></div>
        <div className="stat"><div className="label">Net shrink</div><div className="value">{money(summary.shrink)}</div><div className="small muted">Positive = missing stock</div></div>
      </div>

      {isOpen && (
        <section className="card flush">
          <div className="row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
            <div className="chips" role="group" aria-label="Location">
              {locations.map((l) => {
                const n = counts.filter((c) => c.location_id === l.id).length;
                return <button key={l.id} className="chip" aria-pressed={loc === l.id} onClick={() => { setLoc(l.id); setEntry({}); }}>{l.name}{n ? ` · ${n}` : ''}</button>;
              })}
            </div>
            <div className="chips" style={{ marginLeft: 'auto' }}>
              <button className="chip" aria-pressed={scope === 'week'} onClick={() => setScope('week')}>This week's list</button>
              <button className="chip" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All items</button>
            </div>
          </div>
          <div style={{ padding: '10px 16px' }} className="small muted">
            Count what's physically there. Expected quantities stay hidden until you save, so the count isn't biased. {doneHere}/{list.length} counted at {location?.name}.
          </div>
          <div className="tbl">
            <table>
              <thead><tr><th>Item</th><th>Tier</th><th className="num">Counted</th><th className="num">Saved count</th></tr></thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={4} className="muted" style={{ padding: 20 }}>No items to count here.</td></tr>}
                {list.map((i) => {
                  const saved = countFor(i.id, loc);
                  return (
                    <tr key={i.id}>
                      <td><div style={{ fontWeight: 600 }}>{i.name}</div><div className="small muted">{i.mode === 'box' ? 'Count sealed boxes' : 'Count units'}</div></td>
                      <td className="mono">T{i.tier}</td>
                      <td className="num">
                        <input className="inp" type="number" inputMode="numeric" min={0} aria-label={`Count of ${i.name}`} style={{ width: 100, textAlign: 'right' }}
                          value={entry[i.id] ?? ''} onChange={(e) => setEntry({ ...entry, [i.id]: e.target.value })} />
                      </td>
                      <td className="num">{saved ? Number(saved.counted) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ padding: 16 }}>
            <button className="btn primary" disabled={busy || !Object.values(entry).some((v) => v !== '')} onClick={saveLocation}>{busy ? 'Saving…' : `Save ${location?.name} counts`}</button>
          </div>
        </section>
      )}

      <section className="card flush">
        <div style={{ padding: '14px 16px' }}>
          <h2>Differences</h2>
          <p className="small muted" style={{ margin: '4px 0 0' }}>Expected vs. counted. {isOpen ? 'Add a reason for each, then complete the audit.' : 'Posted as adjustment tickets.'}</p>
        </div>
        <div className="tbl">
          <table>
            <thead><tr><th>Item</th><th>Location</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Diff</th><th className="num">Value</th><th>Reason</th></tr></thead>
            <tbody>
              {variances.length === 0 && <tr><td colSpan={7} className="muted" style={{ padding: 20 }}>{counts.length ? 'Every count matched.' : 'No counts yet.'}</td></tr>}
              {variances.map((c) => {
                const diff = Number(c.counted) - Number(c.expected);
                const key = `${c.item_id}:${c.location_id}`;
                return (
                  <tr key={c.id}>
                    <td>{itemById(c.item_id)?.name ?? 'Archived item'}</td>
                    <td>{locName(c.location_id)}</td>
                    <td className="num">{Number(c.expected)}</td>
                    <td className="num">{Number(c.counted)}</td>
                    <td className="num" style={{ color: diff < 0 ? 'var(--warn)' : undefined }}>{diff > 0 ? `+${diff}` : diff}</td>
                    <td className="num">{money(diff * cost(c.item_id))}</td>
                    <td>
                      {isOpen
                        ? <input className="inp" aria-label="Reason" placeholder="e.g. Unlogged job, damaged" value={reasons[key] ?? c.reason ?? ''} onChange={(e) => setReasons({ ...reasons, [key]: e.target.value })} onBlur={() => saveReason(c)} />
                        : c.reason ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {isOpen ? (
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2>Complete audit</h2>
          <div className="grid2">
            <label className="field"><span className="lbl">Audit notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            <label className="field"><span className="lbl">Order placed (supplier, PO #, what)</span><textarea value={orderNote} onChange={(e) => setOrderNote(e.target.value)} /></label>
          </div>
          <div className="row">
            <button className="btn primary" disabled={busy || counts.length === 0} onClick={complete}>Approve adjustments + complete</button>
            <Link className="btn" to="/">Open reorder list</Link>
          </div>
        </section>
      ) : (
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>Result</h2>
          {audit.notes && <div><b>Notes:</b> {audit.notes}</div>}
          {audit.order_note && <div><b>Order:</b> {audit.order_note}</div>}
          <div className="small muted">Adjustment tickets: {adjTickets.length ? adjTickets.map((t) => ticketCode(t)).join(', ') : 'none'}</div>
        </section>
      )}
    </main>
  );
}
