import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../../lib/data';
import { minMax } from '../../lib/calc';
import { must, supabase } from '../../lib/supabase';
import { parseCsvLine } from '../../lib/format';
import type { Item } from '../../lib/types';
import { ErrorMsg, Sheet, Stepper } from '../../components/ui';

type Filter = 'all' | 'reorder' | 'each' | 'box' | 'job';

export default function Dashboard() {
  const { items, settings, qty, warehouse, trucks, breaks, refresh } = useData();
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [recv, setRecv] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => items.map((i) => {
    const mm = minMax(i, settings);
    const wh = qty(i.id, warehouse?.id);
    const onTrucks = trucks.reduce((t, tr) => t + qty(i.id, tr.id), 0);
    const reorder = !mm.perJob && wh <= mm.min;
    const hasBreak = breaks.some((b) => b.item_id === i.id && b.min_qty > 1);
    return { item: i, mm, wh, onTrucks, reorder, need: Math.max(0, mm.max - wh), hasBreak };
  }), [items, settings, qty, warehouse, trucks, breaks]);

  const visible = rows.filter((r) => {
    if (search && !`${r.item.name} ${r.item.sku ?? ''} ${r.item.category ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'reorder') return r.reorder;
    if (filter === 'each') return r.item.mode === 'each' && r.item.strategy === 'stock';
    if (filter === 'box') return r.item.mode === 'box';
    if (filter === 'job') return r.item.strategy === 'job';
    return true;
  });
  const reorders = rows.filter((r) => r.reorder);

  async function boxMove(i: Item, delta: number) {
    if (!warehouse) return;
    setError(null);
    const res = await supabase.rpc('submit_ticket', delta < 0
      ? { p_type: 'adjust', p_from: warehouse.id, p_to: null, p_lines: [{ item_id: i.id, qty: 1 }], p_note: 'Box used or scrapped' }
      : { p_type: 'receive', p_from: null, p_to: warehouse.id, p_lines: [{ item_id: i.id, qty: 1 }], p_note: 'Box received' });
    if (res.error) setError(res.error.message);
    await refresh();
  }

  async function submitReceive() {
    if (!warehouse) return;
    setBusy(true); setError(null);
    try {
      const lines = Object.entries(recv).filter(([, q]) => q > 0).map(([item_id, q]) => ({ item_id, qty: q }));
      must(await supabase.rpc('submit_ticket', { p_type: 'receive', p_from: null, p_to: warehouse.id, p_lines: lines, p_note: 'Supplier delivery' }));
      setReceiving(false); setRecv({});
      setMsg('Delivery received into the warehouse.');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function importCsv(file: File) {
    setError(null); setMsg(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) throw new Error('CSV needs a header row and at least one item.');
      const head = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
      if (!head.includes('name')) throw new Error('CSV needs a "name" column.');
      const numCols = ['tier', 'unit_cost', 'units_per_box', 'monthly_usage', 'usage_sd', 'lead_days', 'truck_par', 'backup_price', 'trip_cost', 'shelf_life_months', 'storage_max'];
      const boolCols = ['critical', 'serial_tracked'];
      const textCols = ['name', 'sku', 'category', 'mode', 'strategy', 'supplier', 'backup_supplier'];
      const records = lines.slice(1).map((l) => {
        const cells = parseCsvLine(l);
        const rec: Record<string, unknown> = {};
        head.forEach((h, idx) => {
          const v = cells[idx] ?? '';
          if (v === '') return;
          if (numCols.includes(h)) rec[h] = Number(v.replace(/[$,]/g, ''));
          else if (boolCols.includes(h)) rec[h] = /^(y|yes|true|1|x)$/i.test(v);
          else if (textCols.includes(h)) rec[h] = v;
        });
        if (rec.mode && !['each', 'box'].includes(String(rec.mode).toLowerCase())) delete rec.mode;
        if (rec.mode) rec.mode = String(rec.mode).toLowerCase();
        if (rec.strategy) rec.strategy = /job/i.test(String(rec.strategy)) ? 'job' : 'stock';
        if (rec.tier != null && ![1, 2, 3, 4].includes(rec.tier as number)) delete rec.tier;
        return rec;
      }).filter((r) => r.name);
      must(await supabase.from('items').insert(records).select('id'));
      setMsg(`Imported ${records.length} items. Set opening quantities by running your first audit.`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const stockable = items.filter((i) => i.strategy === 'stock');

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>Warehouse stock with live min/max. Click an item to edit it.</p>
        </div>
        <div className="row">
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ''; }} />
          <button className="btn" onClick={() => fileRef.current?.click()}>Import CSV</button>
          <button className="btn" onClick={() => { setRecv({}); setError(null); setReceiving(true); }}>Receive delivery</button>
          <Link className="btn primary" to="/items/new">+ Add item</Link>
        </div>
      </div>

      <ErrorMsg error={receiving ? null : error} />
      {msg && <div className="ok-msg">{msg}</div>}

      <div className="stats">
        <div className="stat"><div className="label">Need reorder</div><div className={`value ${reorders.length ? 'warn' : ''}`}>{reorders.length}</div><div className="small muted">Warehouse at or below min</div></div>
        <div className="stat"><div className="label">Stocked items</div><div className="value">{stockable.length}</div><div className="small muted">{items.filter((i) => i.mode === 'box').length} counted in boxes</div></div>
        <div className="stat"><div className="label">Buy per job</div><div className="value">{items.filter((i) => i.strategy === 'job').length}</div><div className="small muted">No min/max</div></div>
        <div className="stat"><div className="label">Order cycle</div><div className="value">{settings.order_cycle_days}d</div><div className="small muted">Min {settings.min_days_supply}d · max {settings.max_days_supply}d supply</div></div>
      </div>

      <div className="split">
        <section className="main">
          <div className="card flush">
            <div className="row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
              <div className="chips">
                {([['all', 'All'], ['reorder', 'Needs reorder'], ['each', 'Systems, filters + media'], ['box', 'Fittings (boxes)'], ['job', 'Buy per job']] as [Filter, string][]).map(([k, l]) => (
                  <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
                ))}
              </div>
              <input className="inp" type="search" placeholder="Search items" aria-label="Search items" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 240, marginLeft: 'auto' }} />
            </div>
            <div className="tbl">
              <table>
                <thead>
                  <tr><th>Item</th><th>Tier</th><th>Tracked</th><th className="num">Warehouse</th><th className="num">Trucks</th><th className="num">Min / Max</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr><td colSpan={8} className="muted" style={{ padding: 20 }}>{items.length === 0 ? 'No items yet. Add one or import a CSV.' : 'No items match.'}</td></tr>
                  )}
                  {visible.map(({ item: i, mm, wh, onTrucks, reorder, need }) => (
                    <tr key={i.id} className="click" onClick={() => nav(`/items/${i.id}`)}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{i.name}</div>
                        <div className="small muted">
                          {[i.sku, i.mode === 'box' ? `${i.units_per_box ?? '?'} per box` : null, i.critical ? 'Critical' : null, i.serial_tracked ? 'Serial tracked' : null, mm.overridden ? 'Min/max overridden' : null].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td className="mono">T{i.tier}</td>
                      <td>{i.mode === 'box' ? 'Boxes' : 'Each'}</td>
                      <td className="num">{i.strategy === 'job' ? '—' : i.mode === 'box' ? `${wh} bx` : wh}</td>
                      <td className="num">{i.mode === 'box' ? 'on load' : i.strategy === 'job' ? '—' : onTrucks}</td>
                      <td className="num">{mm.perJob ? '—' : `${mm.min} / ${mm.max}`}</td>
                      <td>
                        {mm.perJob ? <span className="pill grey">Buy per job</span>
                          : reorder ? <span className="pill warn">Reorder · {need}{i.mode === 'box' ? ' bx' : ''}</span>
                          : <span className="pill ok">OK</span>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {i.mode === 'box' && (
                          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            <button className="btn sm" aria-label={`Use or scrap one box of ${i.name}`} onClick={() => boxMove(i, -1)}>−1 box</button>
                            <button className="btn sm" aria-label={`Receive one box of ${i.name}`} onClick={() => boxMove(i, 1)}>+1 box</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <aside className="side">
          <section className="card">
            <h2>Reorder list</h2>
            <p className="small muted" style={{ margin: '4px 0 12px' }}>Orders bring each item back to max. Place on audit day.</p>
            {reorders.length === 0 && <div className="muted small">Nothing at or below min.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {reorders.map((r) => (
                <div key={r.item.id} style={{ border: '1px solid var(--line-2)', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 600 }}>{r.item.name}</div>
                  <div className="small mono" style={{ color: 'var(--ink-2)' }}>Have {r.wh} · min {r.mm.min} · order {r.need}{r.item.mode === 'box' ? ' bx' : ''}</div>
                  {r.hasBreak && <Link className="small" style={{ fontWeight: 600 }} to={`/bulk?item=${r.item.id}`}>Price break available · run bulk-buy check</Link>}
                </div>
              ))}
            </div>
          </section>
          <section className="note">
            <h2 style={{ fontSize: 15 }}>How status works</h2>
            <div><b>Each items:</b> reorder when warehouse stock ≤ min. Min covers the order cycle + lead time, never less than {settings.min_days_supply} days of supply.</div>
            <div><b>Box items:</b> two-box rule. Reorder when boxes ≤ min (usually 1). A box counts as used when it's opened or loaded on a truck.</div>
            <div><b>CSV columns:</b> name, sku, category, mode (each/box), tier, unit_cost, units_per_box, monthly_usage, usage_sd, lead_days, truck_par, critical, serial_tracked, strategy (stock/job), supplier, backup_price.</div>
          </section>
        </aside>
      </div>

      {receiving && (
        <Sheet
          title="Receive delivery"
          sub="Supplier → warehouse"
          onClose={() => setReceiving(false)}
          foot={<><ErrorMsg error={error} /><button className="btn primary block" disabled={busy || !Object.values(recv).some((v) => v > 0)} onClick={submitReceive}>{busy ? 'Saving…' : 'Receive into warehouse'}</button></>}
        >
          {stockable.map((i) => (
            <div key={i.id} className="pick-row">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{i.name}</div>
                <div className="small muted">Warehouse has {qty(i.id, warehouse?.id)}{i.mode === 'box' ? ' boxes' : ''}</div>
              </div>
              <Stepper value={recv[i.id] ?? 0} suffix={i.mode === 'box' ? ' bx' : ''} onChange={(v) => setRecv({ ...recv, [i.id]: v })} />
            </div>
          ))}
        </Sheet>
      )}
    </main>
  );
}
