import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { minMax, orderQty, piecesLabel } from '../../lib/calc';
import { readiness } from '../../lib/readiness';
import { must, supabase } from '../../lib/supabase';
import { money, parseCsvLine } from '../../lib/format';
import type { Item } from '../../lib/types';
import { ErrorMsg, Stepper } from '../../components/ui';
import ItemImport from '../../components/ItemImport';
import LabelPrint from '../../components/LabelPrint';
import Scanner from '../../components/Scanner';

type Tab = 'stock' | 'reorder' | 'receive' | 'setup';

interface StockRow {
  item: Item; mm: ReturnType<typeof minMax>; rd: ReturnType<typeof readiness>; wh: number; onTrucks: number;
  reorder: boolean; order: { pieces: number; boxes: number | null }; hasBreak: boolean;
}

export default function Dashboard() {
  const { items, settings, qty, warehouse, trucks, breaks, refresh, supplierName } = useData();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'stock';
  const setTab = (t: Tab) => { const n = new URLSearchParams(params); if (t === 'stock') n.delete('tab'); else n.set('tab', t); setParams(n); };
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [xlsxFile, setXlsxFile] = useState<File | null>(null);

  const rows = useMemo(() => items.map((i) => {
    const mm = minMax(i, settings);
    const rd = readiness(i);
    const wh = qty(i.id, warehouse?.id);
    const onTrucks = trucks.reduce((t, tr) => t + qty(i.id, tr.id), 0);
    // Only items with real usage (or a manual min) can be "low". No data ≠ needs ordering.
    const reorder = rd.canCalc && wh <= mm.min;
    const hasBreak = breaks.some((b) => b.item_id === i.id && b.min_qty > 1);
    const order = orderQty(i, wh, mm.max);
    return { item: i, mm, rd, wh, onTrucks, reorder, order, hasBreak };
  }), [items, settings, qty, warehouse, trucks, breaks]);

  const reorders = rows.filter((r) => r.reorder);
  const noData = rows.filter((r) => r.item.strategy !== 'job' && !r.rd.canCalc);
  const incomplete = rows.filter((r) => r.rd.missing.length > 0);
  const overallPct = rows.length ? Math.round(rows.reduce((t, r) => t + r.rd.done, 0) / rows.reduce((t, r) => t + r.rd.total, 0) * 100) : 0;

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

  const tabs: [Tab, string, number | null][] = [
    ['stock', 'Inventory', null],
    ['reorder', 'Reorder', reorders.length],
    ['receive', 'Receive', null],
    ['setup', 'Item setup', incomplete.length],
  ];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
        </div>
        <div className="row">
          <input ref={fileRef} type="file" accept=".csv,text/csv,.xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { if (/\.xlsx$/i.test(f.name)) setXlsxFile(f); else importCsv(f); } e.target.value = ''; }} />
          <button className="btn" onClick={() => fileRef.current?.click()}>Import items</button>
          <Link className="btn primary" to="/items/new">+ Add item</Link>
        </div>
      </div>

      <div className="chips" role="tablist" aria-label="Inventory view">
        {tabs.map(([k, l, n]) => (
          <button key={k} role="tab" className="chip" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => { setMsg(null); setError(null); setTab(k); }}>
            {l}{n ? <span className="tab-count">{n}</span> : null}
          </button>
        ))}
      </div>

      <ErrorMsg error={error} />
      {msg && <div className="ok-msg">{msg}</div>}

      {tab === 'stock' && <StockTab rows={rows} items={items} />}
      {tab === 'reorder' && <ReorderTab reorders={reorders} noData={noData.length} supplierName={supplierName} goSetup={() => setTab('setup')} goReceive={() => setTab('receive')} />}
      {tab === 'receive' && <ReceiveTab rows={rows} onDone={(m) => { setMsg(m); setTab('stock'); }} />}
      {tab === 'setup' && <SetupTab rows={rows} overallPct={overallPct} supplierName={supplierName} />}

      {xlsxFile && <ItemImport file={xlsxFile} onClose={() => setXlsxFile(null)} />}
    </main>
  );
}

// ---------- Inventory (actual stock) ----------
function StockTab({ rows, items }: { rows: StockRow[]; items: Item[] }) {
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [where, setWhere] = useState<'all' | 'instock' | 'out'>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [labels, setLabels] = useState(false);
  const visible = rows.filter((r) => {
    if (search && !`${r.item.name} ${r.item.sku ?? ''} ${r.item.category ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (where === 'instock') return r.wh + r.onTrucks > 0;
    if (where === 'out') return r.wh + r.onTrucks <= 0;
    return true;
  });
  const value = rows.reduce((t, r) => t + (r.wh + r.onTrucks) * (Number(r.item.unit_cost) || 0), 0);
  return (
    <>
      <div className="stats">
        <div className="stat"><div className="label">Items</div><div className="value">{rows.length}</div><div className="small muted">{rows.filter((r) => r.wh + r.onTrucks > 0).length} with stock on hand</div></div>
        <div className="stat"><div className="label">Pieces on hand</div><div className="value">{rows.reduce((t, r) => t + r.wh, 0)}</div><div className="small muted">Warehouse · {rows.reduce((t, r) => t + r.onTrucks, 0)} more on trucks</div></div>
        <div className="stat"><div className="label">Stock value</div><div className="value">{money(value)}</div><div className="small muted">Only items with a price</div></div>
      </div>
      <div className="card flush">
        <div className="row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div className="chips">
            {([['all', 'All'], ['instock', 'In stock'], ['out', 'None on hand']] as const).map(([k, l]) => (
              <button key={k} className="chip" aria-pressed={where === k} onClick={() => setWhere(k)}>{l}</button>
            ))}
          </div>
          <button className="btn sm" disabled={picked.size === 0} onClick={() => setLabels(true)}>Print labels{picked.size ? ` (${picked.size})` : ''}</button>
          <input className="inp" type="search" placeholder="Search SKU or name" aria-label="Search items" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 240, marginLeft: 'auto' }} />
        </div>
        <div className="tbl">
          <table>
            <thead>
              <tr><th style={{ width: 36 }}><input type="checkbox" aria-label="Select all shown" checked={visible.length > 0 && visible.every((r) => picked.has(r.item.id))} onChange={(e) => setPicked(e.target.checked ? new Set([...picked, ...visible.map((r) => r.item.id)]) : new Set([...picked].filter((id) => !visible.some((r) => r.item.id === id))))} style={{ width: 18, height: 18 }} /></th><th>Item</th><th className="num">Warehouse</th><th className="num">Trucks</th><th className="num">Min / Max</th><th>Status</th></tr>
            </thead>
            <tbody>
              {visible.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 20 }}>{rows.length ? 'No items match.' : 'No items yet.'}</td></tr>}
              {visible.map(({ item: i, mm, rd, wh, onTrucks, reorder, order }) => (
                <tr key={i.id} className="click" onClick={() => nav(`/items/${i.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${i.name}`} checked={picked.has(i.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(i.id); else n.delete(i.id); setPicked(n); }} style={{ width: 18, height: 18 }} /></td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{i.name}</div>
                    <div className="small muted mono">{i.sku}{i.mode === 'box' ? ` · box of ${i.units_per_box ?? '?'}` : ''}</div>
                  </td>
                  <td className="num">{i.strategy === 'job' ? '—' : piecesLabel(i, wh)}</td>
                  <td className="num">{i.strategy === 'job' ? '—' : onTrucks || '—'}</td>
                  <td className="num">{rd.canCalc ? `${mm.min} / ${mm.max}` : '—'}</td>
                  <td>
                    {mm.perJob ? <span className="pill grey">Buy per job</span>
                      : !rd.canCalc ? <span className="pill grey">No usage yet</span>
                      : reorder ? <span className="pill warn">Reorder {order.boxes != null ? `${order.boxes} bx` : order.pieces}</span>
                      : <span className="pill ok">OK</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {labels && <LabelPrint items={items.filter((i) => picked.has(i.id))} onClose={() => { setLabels(false); setPicked(new Set()); }} />}
    </>
  );
}

// ---------- Reorder (only what's actually low) ----------
function ReorderTab({ reorders, noData, supplierName, goSetup, goReceive }: {
  reorders: { item: Item; wh: number; mm: { min: number; max: number }; order: { pieces: number; boxes: number | null }; hasBreak: boolean; rd: { missing: { label: string }[] } }[];
  noData: number; supplierName: (id: string | null) => string; goSetup: () => void; goReceive: () => void;
}) {
  const nav = useNavigate();
  const groups = new Map<string, typeof reorders>();
  for (const r of reorders) {
    const k = r.item.supplier_id ?? '';
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const total = reorders.reduce((t, r) => t + r.order.pieces * (Number(r.item.unit_cost) || 0), 0);
  const unpriced = reorders.filter((r) => !(Number(r.item.unit_cost) > 0)).length;
  return (
    <>
      <div className="stats">
        <div className="stat"><div className="label">Items to order</div><div className={`value ${reorders.length ? 'warn' : ''}`}>{reorders.length}</div><div className="small muted">Warehouse at or below min</div></div>
        <div className="stat"><div className="label">Estimated cost</div><div className="value">{money(total)}</div><div className="small muted">{unpriced ? `${unpriced} item${unpriced === 1 ? '' : 's'} without a price not included` : 'Orders bring each item back to max'}</div></div>
      </div>
      {noData > 0 && (
        <div className="note row" style={{ justifyContent: 'space-between' }}>
          <span><b>{noData} items aren’t checked</b> because they have no usage entered, so the app can’t tell if they’re low.</span>
          <button className="btn sm" onClick={goSetup}>Finish item setup</button>
        </div>
      )}
      {reorders.length === 0 ? (
        <div className="card muted">Nothing needs ordering right now.</div>
      ) : (
        [...groups.entries()].map(([sid, list]) => (
          <div key={sid} className="card flush">
            <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', justifyContent: 'space-between' }}>
              <h2>{sid ? supplierName(sid) : 'No supplier set'}</h2>
              <span className="small muted">{list.length} item{list.length === 1 ? '' : 's'} · {money(list.reduce((t, r) => t + r.order.pieces * (Number(r.item.unit_cost) || 0), 0))}</span>
            </div>
            <div className="tbl">
              <table>
                <thead><tr><th>Item</th><th className="num">Have</th><th className="num">Min</th><th className="num">Order</th><th className="num">Est. cost</th></tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.item.id} className="click" onClick={() => nav(`/items/${r.item.id}`)}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.item.name}</div>
                        <div className="small muted mono">{r.item.sku}</div>
                        {r.hasBreak && <Link className="small" style={{ fontWeight: 600 }} onClick={(e) => e.stopPropagation()} to={`/bulk?item=${r.item.id}`}>Price break available · check bulk buy</Link>}
                      </td>
                      <td className="num">{r.wh}</td>
                      <td className="num">{r.mm.min}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{r.order.boxes != null ? `${r.order.boxes} bx (${r.order.pieces})` : r.order.pieces}</td>
                      <td className="num">{Number(r.item.unit_cost) > 0 ? money(r.order.pieces * Number(r.item.unit_cost)) : <span className="pill amber">No price</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
      {reorders.length > 0 && <div><button className="btn" onClick={goReceive}>Delivery arrived? Receive it</button></div>}
    </>
  );
}

// ---------- Receive (reorder items first; search or scan anything else) ----------
function ReceiveTab({ rows, onDone }: { rows: { item: Item; wh: number; reorder: boolean; order: { pieces: number; boxes: number | null } }[]; onDone: (msg: string) => void }) {
  const { warehouse, refresh } = useData();
  const [recv, setRecv] = useState<Record<string, number>>({});
  const [added, setAdded] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<string | null>(null);

  const stockable = rows.filter((r) => r.item.strategy !== 'job');
  const expected = stockable.filter((r) => r.reorder);
  const extra = added.map((id) => stockable.find((r) => r.item.id === id)).filter((r): r is typeof stockable[number] => !!r && !r.reorder);
  const q = search.trim().toLowerCase();
  const matches = q ? stockable.filter((r) => `${r.item.sku ?? ''} ${r.item.name}`.toLowerCase().includes(q)).slice(0, 12) : [];
  const lines = Object.entries(recv).filter(([, n]) => n > 0);
  const totalPcs = lines.reduce((t, [, n]) => t + n, 0);

  const add = (id: string, pcs: number) => {
    setRecv((p) => ({ ...p, [id]: (p[id] ?? 0) + pcs }));
    setAdded((a) => (a.includes(id) ? a : [...a, id]));
  };

  async function submit() {
    if (!warehouse) return;
    setBusy(true); setError(null);
    try {
      must(await supabase.rpc('submit_ticket', { p_type: 'receive', p_from: null, p_to: warehouse.id, p_lines: lines.map(([item_id, q]) => ({ item_id, qty: q })), p_note: 'Supplier delivery' }));
      await refresh();
      onDone(`Received ${totalPcs} pieces across ${lines.length} item${lines.length === 1 ? '' : 's'} into the warehouse.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const line = (r: typeof stockable[number], hint?: string) => (
    <div key={r.item.id} className="pick-row">
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{r.item.name}</div>
        <div className="small muted"><span className="mono">{r.item.sku}</span> · have {piecesLabel(r.item, r.wh)}{hint ? ` · ${hint}` : ''}</div>
      </div>
      <Stepper value={recv[r.item.id] ?? 0} step={r.item.mode === 'box' ? r.item.units_per_box || 1 : 1} suffix=" pcs" onChange={(v) => { setRecv({ ...recv, [r.item.id]: v }); if (!added.includes(r.item.id)) setAdded([...added, r.item.id]); }} />
    </div>
  );

  return (
    <div className="split">
      <section className="main" style={{ gap: 16 }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="inp" type="search" placeholder="Search SKU or name to add an item" aria-label="Search items" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
            <button type="button" className="btn primary" onClick={() => setScan(true)}>Scan</button>
          </div>
          {lastScan && <div className="small ok-msg">{lastScan}</div>}
          {matches.length > 0 && (
            <div>
              {matches.map((r) => (
                <div key={r.item.id} className="pick-row">
                  <div className="grow"><div style={{ fontWeight: 600 }}>{r.item.name}</div><div className="small muted mono">{r.item.sku}</div></div>
                  <button className="btn sm" onClick={() => { add(r.item.id, r.item.mode === 'box' ? r.item.units_per_box || 1 : 1); setSearch(''); }}>
                    + {r.item.mode === 'box' ? `1 box (${r.item.units_per_box || 1})` : '1'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {q && matches.length === 0 && <div className="small muted">No items match “{search}”.</div>}
        </div>

        <div className="card">
          <h2>On the reorder list ({expected.length})</h2>
          <p className="small muted" style={{ margin: '4px 0 8px' }}>What you’d expect in a delivery. Enter what actually arrived.</p>
          {expected.length === 0 ? <div className="small muted">Nothing is on the reorder list. Search or scan to receive items.</div>
            : expected.map((r) => line(r, `ordered ~${r.order.boxes != null ? `${r.order.boxes} bx` : r.order.pieces}`))}
        </div>

        {extra.length > 0 && (
          <div className="card">
            <h2>Also received</h2>
            {extra.map((r) => line(r))}
          </div>
        )}
      </section>

      <aside className="side">
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>Delivery</h2>
          <div className="small muted">Supplier → warehouse</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 22 }}>{totalPcs} pcs · {lines.length} item{lines.length === 1 ? '' : 's'}</div>
          <ErrorMsg error={error} />
          <button className="btn primary block" disabled={busy || lines.length === 0} onClick={submit}>{busy ? 'Saving…' : 'Receive into warehouse'}</button>
          {lines.length > 0 && <button className="btn block" onClick={() => { setRecv({}); setAdded([]); setLastScan(null); }}>Clear</button>}
        </section>
      </aside>

      {scan && <Scanner title="Scan the delivery" onItem={(r) => {
        if (r.item.strategy === 'job') return `${r.item.name} is buy-per-job (not stocked)`;
        const next = (recv[r.item.id] ?? 0) + r.pieces;
        add(r.item.id, r.pieces);
        const m = `+${r.pieces} ${r.item.sku ?? r.item.name} → ${next}${r.label ? ` (${r.label})` : ''}`;
        setLastScan(m);
        return m;
      }} onClose={() => setScan(false)} />}
    </div>
  );
}

// ---------- Item setup (completion per SKU) ----------
function SetupTab({ rows, overallPct, supplierName }: { rows: { item: Item; rd: ReturnType<typeof readiness> }[]; overallPct: number; supplierName: (id: string | null) => string }) {
  const nav = useNavigate();
  const [show, setShow] = useState<'todo' | 'all' | string>('todo');
  const [search, setSearch] = useState('');
  const keys = ['usage', 'price', 'supplier', 'box', 'confirm'] as const;
  const labels: Record<string, string> = { usage: 'Usage', price: 'Price', supplier: 'Supplier', box: 'Box qty', confirm: 'To confirm' };
  const missingCount = (k: string) => rows.filter((r) => r.rd.missing.some((m) => m.key === k)).length;
  const complete = rows.filter((r) => r.rd.missing.length === 0).length;
  const visible = rows
    .filter((r) => show === 'all' ? true : show === 'todo' ? r.rd.missing.length > 0 : r.rd.missing.some((m) => m.key === show))
    .filter((r) => !search || `${r.item.sku ?? ''} ${r.item.name}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.rd.pct - b.rd.pct || (a.item.sku ?? '').localeCompare(b.item.sku ?? ''));
  return (
    <>
      <div className="stats">
        <div className="stat"><div className="label">Setup complete</div><div className="value">{overallPct}%</div><Bar pct={overallPct} /></div>
        <div className="stat"><div className="label">Ready to order</div><div className="value">{complete} / {rows.length}</div><div className="small muted">Every required field filled</div></div>
      </div>
      <div className="note small">Required to order and keep in stock: <b>usage</b> (drives min/max), <b>price</b>, <b>supplier</b>, <b>box qty</b> for items bought by the box, and clearing any <b>“to confirm”</b> note. Everything else is optional.</div>
      <div className="card flush">
        <div className="row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div className="chips">
            <button className="chip" aria-pressed={show === 'todo'} onClick={() => setShow('todo')}>Incomplete · {rows.length - complete}</button>
            {keys.map((k) => { const n = missingCount(k); return n ? <button key={k} className="chip" aria-pressed={show === k} onClick={() => setShow(k)}>No {labels[k].toLowerCase()} · {n}</button> : null; })}
            <button className="chip" aria-pressed={show === 'all'} onClick={() => setShow('all')}>All · {rows.length}</button>
          </div>
          <input className="inp" type="search" placeholder="Search SKU or name" aria-label="Search items" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 220, marginLeft: 'auto' }} />
        </div>
        <div className="tbl">
          <table>
            <thead><tr><th>SKU</th><th>Item</th><th style={{ width: 140 }}>Complete</th><th>Missing</th></tr></thead>
            <tbody>
              {visible.length === 0 && <tr><td colSpan={4} className="muted" style={{ padding: 20 }}>{show === 'todo' ? 'Every item is set up.' : 'No items match.'}</td></tr>}
              {visible.map(({ item: i, rd }) => (
                <tr key={i.id} className="click" onClick={() => nav(`/items/${i.id}`)}>
                  <td className="mono">{i.sku ?? '—'}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{i.name}</div>
                    <div className="small muted">{[i.supplier_id ? supplierName(i.supplier_id) : null, i.needs_confirm ? `To confirm: ${i.needs_confirm}` : null].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><Bar pct={rd.pct} /><span className="mono small">{rd.pct}%</span></div></td>
                  <td>{rd.missing.length ? <span className="row" style={{ gap: 4 }}>{rd.missing.map((m) => <span key={m.key} className="pill amber">{m.label === 'Confirmed' ? 'To confirm' : m.label}</span>)}</span> : <span className="pill ok">Ready</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${pct}%`, background: pct === 100 ? 'var(--accent)' : pct >= 60 ? 'var(--amber)' : 'var(--warn)' }} />
    </div>
  );
}
