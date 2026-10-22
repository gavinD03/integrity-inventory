import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../../lib/data';
import { must, supabase } from '../../lib/supabase';
import { ticketCode, when, TYPE_LABEL } from '../../lib/format';
import type { Audit, Item, Ticket } from '../../lib/types';
import { ErrorMsg, Sheet, Stepper } from '../../components/ui';
import ChangePassword from '../../components/ChangePassword';

type SheetKind = null | 'load' | 'transfer' | 'count' | 'done';

export default function TechHome() {
  const d = useData();
  const { me, isManager, items, trucks, warehouse, qty, refresh, itemById, locName } = d;
  const [pickedTruck, setPickedTruck] = useState<string | null>(me.truck_id ?? trucks[0]?.id ?? null);
  const truckId = isManager ? pickedTruck : me.truck_id;
  const truck = trucks.find((t) => t.id === truckId);

  const [sheet, setSheet] = useState<SheetKind>(null);
  const [pick, setPick] = useState<Record<string, number>>({});
  const [dest, setDest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string; note: string } | null>(null);
  const [incoming, setIncoming] = useState<Ticket[]>([]);
  const [recent, setRecent] = useState<Ticket[]>([]);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [pwOpen, setPwOpen] = useState(false);

  const tracked = useMemo(() => items.filter((i) => i.mode === 'each'), [items]);
  const onTruck = useMemo(
    () => tracked.filter((i) => i.truck_par > 0 || qty(i.id, truckId) !== 0),
    [tracked, qty, truckId],
  );

  const loadExtras = useCallback(async () => {
    if (!truckId) return;
    const [inc, rec, aud] = await Promise.all([
      supabase.from('tickets').select('*, ticket_lines(*)').eq('to_location_id', truckId).eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('tickets').select('*, ticket_lines(*)').or(`from_location_id.eq.${truckId},to_location_id.eq.${truckId}`).order('created_at', { ascending: false }).limit(8),
      supabase.from('audits').select('*').eq('status', 'open').order('started_at', { ascending: false }).limit(1),
    ]);
    setIncoming((inc.data as Ticket[]) ?? []);
    setRecent((rec.data as Ticket[]) ?? []);
    setAudit(((aud.data as Audit[]) ?? [])[0] ?? null);
  }, [truckId]);

  useEffect(() => { loadExtras(); }, [loadExtras]);

  const open = (k: SheetKind) => {
    setPick({}); setError(null); setSheet(k);
    if (k === 'transfer') setDest(trucks.find((t) => t.id !== truckId)?.id ?? null);
  };
  const close = () => { setSheet(null); setPick({}); setError(null); };

  const sourceItems: Item[] = sheet === 'transfer' ? onTruck.filter((i) => qty(i.id, truckId) > 0) : items;
  const chosen = Object.entries(pick).filter(([, q]) => q > 0);
  const total = chosen.reduce((t, [, q]) => t + q, 0);

  async function submit() {
    if (!truckId || !warehouse) return;
    setBusy(true); setError(null);
    try {
      const isT = sheet === 'transfer';
      const res = must(await supabase.rpc('submit_ticket', {
        p_type: isT ? 'transfer' : 'load',
        p_from: isT ? truckId : warehouse.id,
        p_to: isT ? dest : truckId,
        p_lines: chosen.map(([item_id, q]) => ({ item_id, qty: q })),
      })) as { number: number };
      const code = ticketCode({ type: isT ? 'transfer' : 'load', number: res.number });
      setDone({
        code,
        note: isT
          ? `Removed from ${truck?.name}. Waiting for ${locName(dest)} to confirm receipt.`
          : `Moved from the warehouse to ${truck?.name}. The office can see this ticket now.`,
      });
      setSheet('done');
      setPick({});
      await Promise.all([refresh(), loadExtras()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmIncoming(t: Ticket) {
    setError(null);
    const { error } = await supabase.rpc('confirm_transfer', { p_ticket: t.id });
    if (error) setError(error.message);
    await Promise.all([refresh(), loadExtras()]);
  }

  async function saveCounts() {
    if (!audit || !truckId) return;
    setBusy(true); setError(null);
    try {
      for (const [item_id, c] of Object.entries(counts)) {
        if (c == null) continue;
        must(await supabase.rpc('save_count', { p_audit: audit.id, p_item: item_id, p_location: truckId, p_counted: c }));
      }
      setDone({ code: `Audit #${audit.number}`, note: `Truck count submitted. The inventory manager reviews any differences.` });
      setSheet('done');
      setCounts({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!truckId || !truck) {
    return (
      <div className="tech">
        <div className="tech-head"><div style={{ fontSize: 24, fontWeight: 700 }}>No truck assigned</div></div>
        <div className="tech-body">
          <p>Ask the inventory manager to assign you to a truck. Then refresh this page.</p>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tech">
      <div className="tech-head">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="sub">Hi, {me.full_name}</div>
          {isManager
            ? <Link to="/" style={{ color: 'var(--on-dark-2)', fontSize: 14 }}>← Office</Link>
            : (
              <span className="row" style={{ gap: 14 }}>
                <button className="linkbtn" style={{ fontSize: 13 }} onClick={() => setPwOpen(true)}>Change password</button>
                <button className="linkbtn" style={{ fontSize: 13 }} onClick={() => supabase.auth.signOut()}>Sign out</button>
              </span>
            )}
        </div>
        <div style={{ fontSize: 26, fontWeight: 700 }}>{truck.name}</div>
        {isManager && (
          <div className="chips" role="group" aria-label="Truck">
            {trucks.map((t) => (
              <button key={t.id} className="chip" aria-pressed={t.id === truckId} onClick={() => setPickedTruck(t.id)} style={{ minHeight: 36 }}>{t.name}</button>
            ))}
          </div>
        )}
        <div className="sub">{onTruck.length} items tracked on this truck</div>
      </div>

      <div className="tech-body">
        <ErrorMsg error={sheet ? null : error} />

        {incoming.map((t) => (
          <div key={t.id} className="card" style={{ borderColor: '#e8c98a', background: 'var(--amber-soft)' }}>
            <div style={{ fontWeight: 600 }}>Incoming transfer from {locName(t.from_location_id)}</div>
            <div className="small" style={{ margin: '4px 0 10px' }}>
              {t.ticket_lines.map((l) => `${itemById(l.item_id)?.name ?? 'Item'} × ${Number(l.qty)}`).join(' · ')}
            </div>
            <button className="btn primary" onClick={() => confirmIncoming(t)}>Confirm received</button>
          </div>
        ))}

        {audit && (
          <div className="card">
            <div style={{ fontWeight: 600 }}>Audit #{audit.number} is open</div>
            <div className="small muted" style={{ margin: '4px 0 10px' }}>Count what's physically on your truck.</div>
            <button className="btn dark" onClick={() => { setCounts({}); open('count'); }}>Count my truck</button>
          </div>
        )}

        {onTruck.length === 0 && <div className="muted" style={{ padding: 8 }}>Nothing on this truck yet. Tap Load truck.</div>}
        {onTruck.map((i) => {
          const q = qty(i.id, truckId);
          return (
            <div key={i.id} className="line-card">
              <div className="grow">
                <div className="name">{i.name}</div>
                <div className="small muted">Par {i.truck_par}</div>
              </div>
              <div className="mono" style={{ fontSize: 20 }}>{q}</div>
              {q < i.truck_par && <span className="pill warn">Low</span>}
            </div>
          );
        })}
        <div className="small muted" style={{ padding: '4px 4px 0' }}>Fittings aren't counted on the truck. Fitting boxes are logged when you load them.</div>

        {recent.length > 0 && (
          <div className="card" style={{ marginTop: 8 }}>
            <h2>Recent tickets</h2>
            <div className="kv" style={{ marginTop: 10 }}>
              {recent.map((t) => (
                <div key={t.id}>
                  <span>{ticketCode(t)} · {TYPE_LABEL[t.type]}<br /><span className="small muted" style={{ fontFamily: 'inherit' }}>{when(t.created_at)}</span></span>
                  <span>{t.status === 'pending' ? 'Pending' : t.status === 'cancelled' ? 'Cancelled' : 'Done'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="tech-foot">
        <button className="btn primary block" onClick={() => open('load')}>Load truck</button>
        <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button className="btn" onClick={() => open('transfer')}>Transfer to truck</button>
          <Link className="btn" to={isManager ? `/job?truck=${truckId}` : '/job'}>Close a job</Link>
        </div>
      </div>

      {(sheet === 'load' || sheet === 'transfer') && (
        <Sheet
          title={sheet === 'load' ? 'Load truck' : 'Transfer to another truck'}
          sub={sheet === 'load' ? `Warehouse → ${truck.name}` : `${truck.name} → ${locName(dest)}`}
          onClose={close}
          foot={
            <>
              <ErrorMsg error={error} />
              <button className="btn primary block" disabled={total === 0 || busy || (sheet === 'transfer' && !dest)} onClick={submit}>
                {total === 0 ? 'Add at least one item' : busy ? 'Submitting…' : `${sheet === 'load' ? 'Submit load ticket' : 'Submit transfer'} · ${total} ${total === 1 ? 'item' : 'items'}`}
              </button>
            </>
          }
        >
          {sheet === 'transfer' && (
            <div className="chips" role="group" aria-label="Destination truck" style={{ padding: '6px 0 8px' }}>
              {trucks.filter((t) => t.id !== truckId).map((t) => (
                <button key={t.id} className="chip" aria-pressed={dest === t.id} onClick={() => setDest(t.id)}>To {t.name}</button>
              ))}
            </div>
          )}
          {sourceItems.length === 0 && <div className="muted" style={{ padding: 12 }}>{sheet === 'transfer' ? 'Nothing on your truck to transfer.' : 'No items set up yet.'}</div>}
          {sourceItems.map((i) => {
            const cap = sheet === 'transfer' ? qty(i.id, truckId) : Infinity;
            const sub = sheet === 'transfer'
              ? `On your truck: ${qty(i.id, truckId)}`
              : i.mode === 'box'
                ? `Boxes · warehouse has ${qty(i.id, warehouse?.id)}`
                : `Warehouse ${qty(i.id, warehouse?.id)} · on truck ${qty(i.id, truckId)} / par ${i.truck_par}`;
            return (
              <div key={i.id} className="pick-row">
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{i.name}</div>
                  <div className="small muted">{sub}</div>
                </div>
                <Stepper value={pick[i.id] ?? 0} max={cap} suffix={i.mode === 'box' ? ' bx' : ''} onChange={(v) => setPick({ ...pick, [i.id]: v })} />
              </div>
            );
          })}
        </Sheet>
      )}

      {sheet === 'count' && audit && (
        <Sheet
          title={`Count ${truck.name}`}
          sub={`Audit #${audit.number} · enter what you physically see`}
          onClose={close}
          foot={
            <>
              <ErrorMsg error={error} />
              <button className="btn primary block" disabled={busy || Object.values(counts).every((v) => v == null)} onClick={saveCounts}>
                {busy ? 'Saving…' : 'Submit count'}
              </button>
            </>
          }
        >
          {tracked.filter((i) => i.strategy !== 'job').map((i) => (
            <div key={i.id} className="pick-row">
              <div className="grow"><div style={{ fontWeight: 600 }}>{i.name}</div></div>
              <input
                className="inp"
                type="number"
                inputMode="numeric"
                min={0}
                aria-label={`Count of ${i.name}`}
                style={{ width: 90 }}
                value={counts[i.id] ?? ''}
                onChange={(e) => setCounts({ ...counts, [i.id]: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </div>
          ))}
        </Sheet>
      )}

      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}

      {sheet === 'done' && done && (
        <Sheet title="Submitted" onClose={close} foot={<button className="btn dark block" onClick={close}>Done</button>}>
          <div style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="mono" style={{ fontSize: 20, color: 'var(--accent)' }}>{done.code}</div>
            <div className="ok-msg">{done.note}</div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
