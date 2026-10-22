import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../../lib/data';
import { minMax, orderQty, piecesLabel } from '../../lib/calc';
import { must, supabase } from '../../lib/supabase';
import { parseCsvLine } from '../../lib/format';
import { ErrorMsg, Sheet, Stepper } from '../../components/ui';
import ItemImport from '../../components/ItemImport';
import LabelPrint from '../../components/LabelPrint';
import Scanner from '../../components/Scanner';

type Filter = 'all' | 'reorder' | 'confirm' | 'each' | 'box' | 'job';

export default function Dashboard() {
  const { items, settings, qty, warehouse, trucks, breaks, refresh } = useData();
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [recv, setRecv] = useState<Record<string, number>>({});
  const [recvScan, setRecvScan] = useState(false);
  const [recvSearch, setRecvSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [xlsxFile, setXlsxFile] = useState<File | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [labels, setLabels] = useState(false);

  const rows = useMemo(() => items.map((i) => {
    const mm = minMax(i, settings);
    const wh = qty(i.id, warehouse?.id);
    const onTrucks = trucks.reduce((t, tr) => t + qty(i.id, tr.id), 0);
    const reorder = !mm.perJob && wh <= mm.min;
    const hasBreak = breaks.some((b) => b.item_id === i.id && b.min_qty > 1);
    const order = orderQty(i, wh, mm.max);
    return { item: i, mm, wh, onTrucks, reorder, order, hasBreak };
  }), [items, settings, qty, warehouse, trucks, breaks]);

  const visible = rows.filter((r) => {
    if (search && !`${r.item.name} ${r.item.sku ?? ''} ${r.item.category ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'reorder') return r.reorder;
    if (filter === 'confirm') return !!r.item.needs_confirm;
    if (filter === 'each') return r.item.mode === 'each' && r.item.strategy !== 'job';
    if (filter === 'box') return r.item.mode === 'box';
    if (filter === 'job') return r.item.strategy === 'job';
    return true;
  });
  const reorders = rows.filter((r) => r.reorder);

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
        if (rec.strategy) rec.strategy = /job|buy/i.test(String(rec.strategy)) ? 'job' : /ware/i.test(String(rec.strategy)) ? 'warehouse' : 'truck';
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

  const stockable = items.filter((i) => i.strategy !== 'job');

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>Warehouse stock with live min/max. Click an item to edit it.</p>
        </div>
        <div className="row">
          <input ref={fileRef} type="file" accept=".csv,text/csv,.xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { if (/\.xlsx$/i.test(f.name)) setXlsxFile(f); else importCsv(f); } e.target.value = ''; }} />
          <button className="btn" onClick={() => fileRef.current?.click()}>Import items</button>
          <button className="btn" disabled={picked.size === 0} onClick={() => setLabels(true)}>Print labels{picked.size ? ` (${picked.size})` : ''}</button>
          <button className="btn" onClick={() => { setRecv({}); setError(null); setReceiving(true); }}>Receive delivery</button>
          <Link className="btn primary" to="/items/new">+ Add item</Link>
        </div>
      </div>

      <ErrorMsg error={receiving ? null : error} />
      {msg && <div className="ok-msg">{msg}</div>}

      <div className="stats">
        <div className="stat"><div className="label">Need reorder</div><div className={`value ${reorders.length ? 'warn' : ''}`}>{reorders.length}</div><div className="small muted">Warehouse at or below min</div></div>
        <div className="stat"><div className="label">Stocked items</div><div className="value">{stockable.length}</div><div className="small muted">{items.filter((i) => i.mode === 'box').length} bought by the box</div></div>
        <div className="stat"><div className="label">Buy per job</div><div className="value">{items.filter((i) => i.strategy === 'job').length}</div><div className="small muted">No min/max</div></div>
        <div className="stat"><div className="label">Order cycle</div><div className="value">{settings.order_cycle_days}d</div><div className="small muted">Min {settings.min_days_supply}d · max {settings.max_days_supply}d supply</div></div>
      </div>

      <div className="split">
        <section className="main">
          <div className="card flush">
            <div className="row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
              <div className="chips">
                {([['all', 'All'], ['reorder', 'Needs reorder'], ['confirm', `To confirm · ${items.filter((i) => i.needs_confirm).length}`], ['each', 'Systems, filters + media'], ['box', 'Bought by the box'], ['job', 'Buy per job']] as [Filter, string][]).map(([k, l]) => (
                  <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
                ))}
              </div>
              <input className="inp" type="search" placeholder="Search items" aria-label="Search items" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 240, marginLeft: 'auto' }} />
            </div>
            <div className="tbl">
              <table>
                <thead>
                  <tr><th style={{ width: 36 }}><input type="checkbox" aria-label="Select all shown" checked={visible.length > 0 && visible.every((r) => picked.has(r.item.id))} onChange={(e) => setPicked(e.target.checked ? new Set([...picked, ...visible.map((r) => r.item.id)]) : new Set([...picked].filter((id) => !visible.some((r) => r.item.id === id))))} style={{ width: 18, height: 18 }} /></th><th>Item</th><th>Tier</th><th>Tracked</th><th className="num">Warehouse</th><th className="num">Trucks</th><th className="num">Min / Max (pcs)</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr><td colSpan={8} className="muted" style={{ padding: 20 }}>{items.length === 0 ? 'No items yet. Add one or import a CSV.' : 'No items match.'}</td></tr>
                  )}
                  {visible.map(({ item: i, mm, wh, onTrucks, reorder, order }) => (
                    <tr key={i.id} className="click" onClick={() => nav(`/items/${i.id}`)}>
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${i.name}`} checked={picked.has(i.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(i.id); else n.delete(i.id); setPicked(n); }} style={{ width: 18, height: 18 }} /></td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{i.name}</div>
                        <div className="small muted">
                          {[i.sku, i.needs_confirm ? `To confirm: ${i.needs_confirm}` : null, i.mode === 'box' ? `${i.units_per_box ?? '?'} per box` : null, i.critical ? 'Critical' : null, i.serial_tracked ? 'Serial tracked' : null, mm.overridden ? 'Min/max overridden' : null].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td className="mono">T{i.tier}</td>
                      <td>{i.mode === 'box' ? `Box of ${i.units_per_box ?? '?'}` : 'Each'}</td>
                      <td className="num">{i.strategy === 'job' ? '—' : piecesLabel(i, wh)}</td>
                      <td className="num">{i.strategy === 'job' ? '—' : onTrucks}</td>
                      <td className="num">{mm.perJob ? '—' : `${mm.min} / ${mm.max}`}</td>
                      <td>
                        {mm.perJob ? <span className="pill grey">Buy per job</span>
                          : reorder ? <span className="pill warn">Reorder · {order.boxes != null ? `${order.boxes} bx` : order.pieces}</span>
                          : <span className="pill ok">OK</span>}
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
                  <div className="small mono" style={{ color: 'var(--ink-2)' }}>Have {r.wh} · min {r.mm.min} · order {r.order.boxes != null ? `${r.order.boxes} ${r.order.boxes === 1 ? 'box' : 'boxes'} (${r.order.pieces} pcs)` : `${r.order.pieces} pcs`}</div>
                  {r.hasBreak && <Link className="small" style={{ fontWeight: 600 }} to={`/bulk?item=${r.item.id}`}>Price break available · run bulk-buy check</Link>}
                </div>
              ))}
            </div>
          </section>
          <section className="note">
            <h2 style={{ fontSize: 15 }}>How status works</h2>
            <div><b>All items:</b> reorder when warehouse stock ≤ min. Min covers the order cycle + lead time, never less than {settings.min_days_supply} days of supply.</div>
            <div><b>Bought by the box:</b> stock and min/max are in pieces; orders round up to whole boxes, and max is always at least min + one box.</div>
            <div><b>Import items:</b> upload the master .xlsx (Items tab), or a CSV with columns: name, sku, category, mode (each/box), tier, unit_cost, units_per_box, monthly_usage, usage_sd, lead_days, truck_par, critical, serial_tracked, strategy (truck/warehouse/job), supplier, backup_price.</div>
          </section>
        </aside>
      </div>

      {labels && <LabelPrint items={items.filter((i) => picked.has(i.id))} onClose={() => { setLabels(false); setPicked(new Set()); }} />}
      {xlsxFile && <ItemImport file={xlsxFile} onClose={() => setXlsxFile(null)} />}

      {receiving && (
        <Sheet
          title="Receive delivery"
          sub="Supplier → warehouse"
          onClose={() => setReceiving(false)}
          foot={<><ErrorMsg error={error} /><button className="btn primary block" disabled={busy || !Object.values(recv).some((v) => v > 0)} onClick={submitReceive}>{busy ? 'Saving…' : 'Receive into warehouse'}</button></>}
        >
          <div className="row" style={{ flexWrap: 'nowrap', padding: '6px 0' }}>
            <input className="inp" type="search" placeholder="Search SKU or name" aria-label="Search items" value={recvSearch} onChange={(e) => setRecvSearch(e.target.value)} />
            <button type="button" className="btn primary" onClick={() => setRecvScan(true)}>Scan</button>
          </div>
          {recvScan && <Scanner title="Scan the delivery" onItem={(r) => {
            if (r.item.strategy === 'job') return `${r.item.name} is buy-per-job (not stocked)`;
            const next = (recv[r.item.id] ?? 0) + r.pieces;
            setRecv((p) => ({ ...p, [r.item.id]: (p[r.item.id] ?? 0) + r.pieces }));
            return `+${r.pieces} ${r.item.sku ?? r.item.name} → ${next}${r.label ? ` (${r.label})` : ''}`;
          }} onClose={() => setRecvScan(false)} />}
          {stockable.filter((i) => !recvSearch.trim() || `${i.sku ?? ''} ${i.name}`.toLowerCase().includes(recvSearch.toLowerCase())).map((i) => (
            <div key={i.id} className="pick-row">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{i.name}</div>
                <div className="small muted">Warehouse has {piecesLabel(i, qty(i.id, warehouse?.id))} pcs{i.mode === 'box' ? ` · ± steps by a box of ${i.units_per_box ?? '?'}` : ''}</div>
              </div>
              <Stepper value={recv[i.id] ?? 0} step={i.mode === 'box' ? i.units_per_box || 1 : 1} suffix=" pcs" onChange={(v) => setRecv({ ...recv, [i.id]: v })} />
            </div>
          ))}
        </Sheet>
      )}
    </main>
  );
}
