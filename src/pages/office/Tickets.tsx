import { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../../lib/data';
import { must, supabase } from '../../lib/supabase';
import { ticketCode, TYPE_LABEL, when } from '../../lib/format';
import type { Profile, Ticket, TicketType } from '../../lib/types';
import { ErrorMsg, Sheet, Stepper } from '../../components/ui';

type TypeFilter = 'all' | 'load' | 'job' | 'transfer' | 'return' | 'other';

export default function Tickets() {
  const { itemById, locName, locations, items, refresh } = useData();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [type, setType] = useState<TypeFilter>('all');
  const [tech, setTech] = useState<string>('all');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [adj, setAdj] = useState<{ loc: string; dir: 'out' | 'in'; reason: string; lines: Record<string, number> }>({ loc: '', dir: 'out', reason: '', lines: {} });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [t, p] = await Promise.all([
      supabase.from('tickets').select('*, ticket_lines(*)').order('created_at', { ascending: false }).limit(300),
      supabase.from('profiles').select('*').order('full_name'),
    ]);
    if (t.error) setError(t.error.message);
    setTickets((t.data as Ticket[]) ?? []);
    setPeople((p.data as Profile[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? 'Unknown';
  const byTech = tickets.filter((t) => tech === 'all' || t.created_by === tech);
  const matchType = (t: Ticket, f: TypeFilter) => f === 'all' || (f === 'other' ? ['adjust', 'receive', 'reverse'].includes(t.type) : t.type === f);
  const visible = byTech.filter((t) => matchType(t, type) && (!onlyOpen || t.status === 'pending' || t.flagged));
  const today = new Date().toDateString();
  const stats = useMemo(() => ({
    today: tickets.filter((t) => new Date(t.created_at).toDateString() === today).length,
    pending: tickets.filter((t) => t.status === 'pending').length,
    flagged: tickets.filter((t) => t.flagged).length,
  }), [tickets, today]);

  async function act(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setError(null);
    const { error } = await fn();
    if (error) setError(error.message);
    await Promise.all([load(), refresh()]);
  }

  async function submitAdjust() {
    setBusy(true); setError(null);
    try {
      const lines = Object.entries(adj.lines).filter(([, q]) => q > 0).map(([item_id, qty]) => ({ item_id, qty }));
      must(await supabase.rpc('submit_ticket', {
        p_type: 'adjust',
        p_from: adj.dir === 'out' ? adj.loc : null,
        p_to: adj.dir === 'in' ? adj.loc : null,
        p_lines: lines,
        p_note: adj.reason,
      }));
      setAdjusting(false);
      await Promise.all([load(), refresh()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const statusPill = (t: Ticket) => {
    if (t.reversed_by_ticket_id) return <span className="pill grey">Reversed</span>;
    if (t.status === 'pending') return <span className="pill amber">Pending receipt</span>;
    if (t.status === 'cancelled') return <span className="pill grey">Cancelled</span>;
    if (t.status === 'confirmed') return <span className="pill ok">Received</span>;
    return <span className="pill ok">Applied</span>;
  };

  const route = (t: Ticket) => {
    const from = t.from_location_id ? locName(t.from_location_id) : t.type === 'receive' ? 'Supplier' : '—';
    const to = t.to_location_id ? locName(t.to_location_id) : t.type === 'job' ? `Job ${t.job_ref ?? ''}`.trim() : t.type === 'adjust' ? 'Written off' : '—';
    return `${from} → ${to}`;
  };

  const counts = (f: TypeFilter) => byTech.filter((t) => matchType(t, f)).length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Inventory tickets</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>Every stock move. Loads and job usage apply on submit; transfers wait for the receiving truck.</p>
        </div>
        <button className="btn" onClick={() => { setAdj({ loc: locations[0]?.id ?? '', dir: 'out', reason: '', lines: {} }); setError(null); setAdjusting(true); }}>New adjustment</button>
      </div>

      <div className="stats">
        <div className="stat"><div className="label">Tickets today</div><div className="value">{stats.today}</div></div>
        <div className="stat"><div className="label">Pending receipt</div><div className="value">{stats.pending}</div></div>
        <div className="stat"><div className="label">Flagged</div><div className={`value ${stats.flagged ? 'warn' : ''}`}>{stats.flagged}</div></div>
      </div>

      <ErrorMsg error={adjusting ? null : error} />

      <div className="split">
        <section className="main">
          <div className="chips">
            {([['all', 'All'], ['load', TYPE_LABEL.load], ['job', TYPE_LABEL.job], ['transfer', TYPE_LABEL.transfer], ['return', TYPE_LABEL.return], ['other', 'Adjust / receive / reverse']] as [TypeFilter, string][]).map(([k, l]) => (
              <button key={k} className="chip" aria-pressed={type === k} onClick={() => setType(k)}>{l} · {counts(k)}</button>
            ))}
          </div>
          <div className="row">
            <label className="field" style={{ minWidth: 220 }}>
              <span className="lbl">Submitted by</span>
              <select className="inp" value={tech} onChange={(e) => setTech(e.target.value)}>
                <option value="all">Everyone</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.truck_id ? ` · ${locName(p.truck_id)}` : ''}</option>)}
              </select>
            </label>
            <label className="check" style={{ alignSelf: 'flex-end' }}><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Only pending or flagged</label>
          </div>

          {visible.length === 0 && <div className="card muted">No tickets match.</div>}
          {visible.map((t) => {
            const isOpen = openId === t.id;
            return (
              <article key={t.id} className="card flush">
                <div className="row" style={{ padding: '14px 16px', gap: '10px 16px' }}>
                  <div className="mono" style={{ minWidth: 76 }}>{ticketCode(t)}</div>
                  <span className="tag">{TYPE_LABEL[t.type as TicketType]}</span>
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{route(t)}</div>
                    <div className="small muted">{nameOf(t.created_by)} · {when(t.created_at)} · {t.ticket_lines.length} {t.ticket_lines.length === 1 ? 'line' : 'lines'}</div>
                  </div>
                  {t.flagged && <span className="pill warn">Flagged</span>}
                  {statusPill(t)}
                  <button className="btn sm" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : t.id)}>{isOpen ? 'Hide' : 'Details'}</button>
                </div>
                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--line-2)', padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {t.flag_note && <div className="err">Flag: {t.flag_note}</div>}
                    {t.note && <div className="small">Note: {t.note}</div>}
                    {t.reverses_ticket_id && <div className="small muted">Reverses {ticketCode(tickets.find((x) => x.id === t.reverses_ticket_id) ?? { type: 'load', number: 0 })}</div>}
                    <div className="kv">
                      {t.ticket_lines.map((l) => (
                        <div key={l.id}>
                          <span style={{ fontFamily: 'inherit', textAlign: 'left' }}>{itemById(l.item_id)?.name ?? 'Archived item'}{l.serial ? ` · SN ${l.serial}` : ''}</span>
                          <span>{Number(l.qty)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="row">
                      {t.status === 'pending' && <>
                        <button className="btn sm" onClick={() => act(() => supabase.rpc('confirm_transfer', { p_ticket: t.id }))}>Mark received</button>
                        <button className="btn sm" onClick={() => act(() => supabase.rpc('cancel_transfer', { p_ticket: t.id }))}>Cancel transfer</button>
                      </>}
                      {t.flagged
                        ? <button className="btn sm" onClick={() => act(() => supabase.rpc('set_ticket_flag', { p_ticket: t.id, p_flag: false }))}>Clear flag</button>
                        : <button className="btn sm" onClick={() => { const note = prompt('Flag note (what needs follow-up?)') ?? ''; act(() => supabase.rpc('set_ticket_flag', { p_ticket: t.id, p_flag: true, p_note: note })); }}>Flag for follow-up</button>}
                      {(t.status === 'applied' || t.status === 'confirmed') && !t.reversed_by_ticket_id && t.type !== 'reverse' && (
                        <button className="btn sm" onClick={() => {
                          const note = prompt(`Reverse ${ticketCode(t)}? This posts an offsetting ticket. Reason:`);
                          if (note !== null) act(() => supabase.rpc('reverse_ticket', { p_ticket: t.id, p_note: note }));
                        }}>Reverse</button>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </section>

        <aside className="side">
          <section className="note">
            <h2 style={{ fontSize: 15 }}>Ticket types</h2>
            <div><b>LD · Warehouse → truck:</b> tech taps Load truck. Stock moves on submit.</div>
            <div><b>JB · Truck → job:</b> created when a tech closes a job. Serial numbers link to the job.</div>
            <div><b>TR · Truck → truck:</b> pending until the receiving tech confirms. Stock leaves the sending truck right away.</div>
            <div><b>RT · Truck → warehouse:</b> tech returns unused stock. Applies on submit.</div>
            <div><b>AD · Adjustment / RC · Received:</b> office-only. Audits create adjustments automatically.</div>
            <h2 style={{ fontSize: 15, marginTop: 6 }}>Your actions</h2>
            <div><b>Flag:</b> marks it for follow-up; stock stays moved.</div>
            <div><b>Reverse:</b> posts an offsetting RV ticket. Nothing is ever deleted.</div>
          </section>
        </aside>
      </div>

      {adjusting && (
        <Sheet
          title="New adjustment"
          sub="Corrections outside an audit. A reason is required."
          onClose={() => setAdjusting(false)}
          foot={<><ErrorMsg error={error} /><button className="btn primary block" disabled={busy || !adj.loc || !adj.reason.trim() || !Object.values(adj.lines).some((v) => v > 0)} onClick={submitAdjust}>{busy ? 'Saving…' : 'Post adjustment'}</button></>}
        >
          <div className="grid2" style={{ padding: '8px 0' }}>
            <label className="field"><span className="lbl">Location</span>
              <select className="inp" value={adj.loc} onChange={(e) => setAdj({ ...adj, loc: e.target.value })}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="field"><span className="lbl">Direction</span>
              <select className="inp" value={adj.dir} onChange={(e) => setAdj({ ...adj, dir: e.target.value as 'out' | 'in' })}>
                <option value="out">Remove (damaged, lost, used)</option>
                <option value="in">Add (found, correction)</option>
              </select>
            </label>
          </div>
          <label className="field" style={{ paddingBottom: 8 }}><span className="lbl">Reason</span>
            <input className="inp" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="e.g. Wet bag, scrapped" />
          </label>
          {items.map((i) => (
            <div key={i.id} className="pick-row">
              <div className="grow"><div style={{ fontWeight: 600 }}>{i.name}</div></div>
              <Stepper value={adj.lines[i.id] ?? 0} suffix=" pcs" onChange={(v) => setAdj({ ...adj, lines: { ...adj.lines, [i.id]: v } })} />
            </div>
          ))}
        </Sheet>
      )}
    </main>
  );
}
