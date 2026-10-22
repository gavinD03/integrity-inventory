import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { minMax, orderQty, piecesLabel } from '../../lib/calc';
import { readiness } from '../../lib/readiness';
import { poCode, useOrders, type PurchaseOrder } from '../../lib/orders';
import { must, supabase } from '../../lib/supabase';
import { money, parseCsvLine, when } from '../../lib/format';
import type { Item } from '../../lib/types';
import { ErrorMsg, Stepper } from '../../components/ui';
import ItemImport from '../../components/ItemImport';
import LabelPrint from '../../components/LabelPrint';
import Scanner from '../../components/Scanner';

type Tab = 'stock' | 'reorder' | 'receive';

interface Row {
  item: Item;
  mm: ReturnType<typeof minMax>;
  rd: ReturnType<typeof readiness>;
  wh: number;
  onTrucks: number;
  onOrder: number;
  /** Warehouse + on order is at or below min. Needs usage (or a manual min) to be judged at all. */
  reorder: boolean;
  /** Suggested order to get warehouse + on order back to max, in whole boxes for box items. */
  order: { pieces: number; boxes: number | null };
  hasBreak: boolean;
}

const boxStep = (i: Item) => (i.mode === 'box' ? Math.max(1, Number(i.units_per_box) || 1) : 1);

export default function Dashboard() {
  const { items, settings, qty, warehouse, trucks, breaks, refresh } = useData();
  const orders = useOrders();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'stock';
  const go = (t: Tab, extra: Record<string, string> = {}) => {
    const n = new URLSearchParams();
    if (t !== 'stock') n.set('tab', t);
    for (const [k, v] of Object.entries(extra)) n.set(k, v);
    setParams(n);
  };
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [xlsxFile, setXlsxFile] = useState<File | null>(null);

  const rows: Row[] = useMemo(() => items.map((i) => {
    const mm = minMax(i, settings);
    const rd = readiness(i);
    const wh = qty(i.id, warehouse?.id);
    const onTrucks = trucks.reduce((t, tr) => t + qty(i.id, tr.id), 0);
    const onOrder = orders.onOrder.get(i.id) ?? 0;
    const position = wh + onOrder;
    return {
      item: i, mm, rd, wh, onTrucks, onOrder,
      reorder: rd.canCalc && position <= mm.min,
      order: orderQty(i, position, mm.max),
      hasBreak: breaks.some((b) => b.item_id === i.id && b.min_qty > 1),
    };
  }), [items, settings, qty, warehouse, trucks, breaks, orders.onOrder]);

  const reorders = rows.filter((r) => r.reorder);
  const refreshAll = async () => { await Promise.all([refresh(), orders.reload()]); };

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

  const tabs: [Tab, string, number][] = [
    ['stock', 'Inventory', 0],
    ['reorder', 'Reorder', reorders.length],
    ['receive', 'Receive', orders.openOrders.length],
  ];

  return (
    <main className="page">
      <div className="page-head">
        <h1>Inventory</h1>
        <div className="row">
          <input ref={fileRef} type="file" accept=".csv,text/csv,.xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { if (/\.xlsx$/i.test(f.name)) setXlsxFile(f); else importCsv(f); } e.target.value = ''; }} />
          <button className="btn" onClick={() => fileRef.current?.click()}>Import items</button>
          <Link className="btn primary" to="/items/new">+ Add item</Link>
        </div>
      </div>

      <div className="chips" role="tablist" aria-label="Inventory view">
        {tabs.map(([k, l, n]) => (
          <button key={k} role="tab" className="chip" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => { setMsg(null); setError(null); go(k); }}>
            {l}{n ? <span className="tab-count">{n}</span> : null}
          </button>
        ))}
      </div>

      <ErrorMsg error={error ?? orders.error} />
      {msg && <div className="ok-msg">{msg}</div>}

      {tab === 'stock' && <StockTab rows={rows} />}
      {tab === 'reorder' && (
        <ReorderTab
          key={orders.openOrders.map((o) => o.id).join()}
          rows={rows} openOrders={orders.openOrders}
          onPlaced={async (m) => { await orders.reload(); setMsg(m); }}
          onChanged={refreshAll}
          receive={(po) => go('receive', po ? { po } : {})}
        />
      )}
      {tab === 'receive' && (
        <ReceiveTab
          rows={rows} openOrders={orders.openOrders} focusPo={params.get('po')}
          onDone={async (m) => { await refreshAll(); setMsg(m); go('stock'); }}
        />
      )}

      {xlsxFile && <ItemImport file={xlsxFile} onClose={() => setXlsxFile(null)} />}
    </main>
  );
}

// ---------------- Inventory: every item, complete or not ----------------
function StockTab({ rows }: { rows: Row[] }) {
  const { items } = useData();
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
  const incomplete = rows.filter((r) => r.rd.missing.length).length;
  return (
    <>
      <div className="stats">
        <div className="stat"><div className="label">Items</div><div className="value">{rows.length}</div><div className="small muted">{rows.filter((r) => r.wh + r.onTrucks > 0).length} with stock on hand</div></div>
        <div className="stat"><div className="label">Pieces in warehouse</div><div className="value">{rows.reduce((t, r) => t + r.wh, 0)}</div><div className="small muted">{rows.reduce((t, r) => t + r.onTrucks, 0)} more on trucks</div></div>
        <div className="stat"><div className="label">Stock value</div><div className="value">{money(value)}</div><div className="small muted">Items with a price only</div></div>
      </div>
      {incomplete > 0 && <div className="note small" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}><span>{incomplete} items are missing setup info (usage, price, supplier or box qty). They’re listed here anyway.</span><Link className="btn sm" to="/inventory-settings">Finish setup</Link></div>}
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
              <tr><th style={{ width: 36 }}><input type="checkbox" aria-label="Select all shown" checked={visible.length > 0 && visible.every((r) => picked.has(r.item.id))} onChange={(e) => setPicked(e.target.checked ? new Set([...picked, ...visible.map((r) => r.item.id)]) : new Set([...picked].filter((id) => !visible.some((r) => r.item.id === id))))} style={{ width: 18, height: 18 }} /></th><th>Item</th><th className="num">Warehouse</th><th className="num">Trucks</th><th className="num">On order</th><th className="num">Min / Max</th><th>Status</th></tr>
            </thead>
            <tbody>
              {visible.length === 0 && <tr><td colSpan={7} className="muted" style={{ padding: 20 }}>{rows.length ? 'No items match.' : 'No items yet.'}</td></tr>}
              {visible.map(({ item: i, mm, rd, wh, onTrucks, onOrder, reorder, order }) => (
                <tr key={i.id} className="click" onClick={() => nav(`/items/${i.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${i.name}`} checked={picked.has(i.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(i.id); else n.delete(i.id); setPicked(n); }} style={{ width: 18, height: 18 }} /></td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{i.name}</div>
                    <div className="small muted mono">{i.sku}{i.mode === 'box' ? ` · box of ${i.units_per_box ?? '?'}` : ''}</div>
                  </td>
                  <td className="num">{piecesLabel(i, wh)}</td>
                  <td className="num">{onTrucks || '—'}</td>
                  <td className="num">{onOrder || '—'}</td>
                  <td className="num">{rd.canCalc ? `${mm.min} / ${mm.max}` : '—'}</td>
                  <td>
                    {mm.perJob ? <span className="pill grey">Buy per job</span>
                      : reorder ? <span className="pill warn">Reorder {order.boxes != null ? `${order.boxes} bx` : order.pieces}</span>
                      : onOrder > 0 ? <span className="pill amber">On order</span>
                      : !rd.canCalc ? <span className="pill grey">No usage yet</span>
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

// ---------------- Search + scan box shared by Reorder and Receive ----------------
function AddItem({ rows, onAdd, scanTitle, placeholder }: { rows: Row[]; onAdd: (r: Row, pieces: number) => string; scanTitle: string; placeholder: string }) {
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const q = search.trim().toLowerCase();
  const matches = q ? rows.filter((r) => r.item.strategy !== 'job' && `${r.item.sku ?? ''} ${r.item.name}`.toLowerCase().includes(q)).slice(0, 10) : [];
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input className="inp" type="search" placeholder={placeholder} aria-label="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className="btn primary" onClick={() => setScan(true)}>Scan</button>
      </div>
      {last && <div className="small ok-msg">{last}</div>}
      {matches.map((r) => (
        <div key={r.item.id} className="pick-row">
          <div className="grow"><div style={{ fontWeight: 600 }}>{r.item.name}</div><div className="small muted"><span className="mono">{r.item.sku}</span> · have {r.wh}{r.onOrder ? ` · ${r.onOrder} on order` : ''}</div></div>
          <button className="btn sm" onClick={() => { setLast(onAdd(r, boxStep(r.item))); setSearch(''); }}>+ Add</button>
        </div>
      ))}
      {q && matches.length === 0 && <div className="small muted">No items match “{search}”.</div>}
      {scan && <Scanner title={scanTitle} onItem={(s) => {
        const r = rows.find((x) => x.item.id === s.item.id);
        if (!r || r.item.strategy === 'job') return `${s.item.name} is buy-per-job (not stocked)`;
        const m = onAdd(r, s.pieces);
        setLast(m);
        return m;
      }} onClose={() => setScan(false)} />}
    </div>
  );
}

// ---------------- Reorder: build and place orders ----------------
interface Draft { qty: number; include: boolean; manual: boolean }

function ReorderTab({ rows, openOrders, onPlaced, onChanged, receive }: {
  rows: Row[]; openOrders: PurchaseOrder[];
  onPlaced: (msg: string) => void; onChanged: () => Promise<void>; receive: (po?: string) => void;
}) {
  const { supplierName, itemById } = useData();
  const [draft, setDraft] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(rows.filter((r) => r.reorder).map((r) => [r.item.id, { qty: r.order.pieces, include: true, manual: false }])));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = (r: Row, pieces: number) => {
    const cur = draft[r.item.id];
    const qty = (cur?.include ? cur.qty : 0) + pieces;
    setDraft((d) => ({ ...d, [r.item.id]: { qty, include: true, manual: cur ? cur.manual : true } }));
    return `${r.item.sku ?? r.item.name}: ordering ${qty}`;
  };

  const lines = Object.entries(draft).map(([id, d]) => ({ row: rows.find((r) => r.item.id === id), ...d })).filter((l): l is { row: Row } & Draft => !!l.row);
  const groups = new Map<string, typeof lines>();
  for (const l of lines) { const k = l.row.item.supplier_id ?? ''; groups.set(k, [...(groups.get(k) ?? []), l]); }
  const chosen = lines.filter((l) => l.include && l.qty > 0);
  const chosenGroups = new Set(chosen.map((l) => l.row.item.supplier_id ?? ''));
  const total = chosen.reduce((t, l) => t + l.qty * (Number(l.row.item.unit_cost) || 0), 0);
  const noData = rows.filter((r) => r.item.strategy !== 'job' && !r.rd.canCalc).length;

  async function place() {
    setBusy(true); setError(null);
    try {
      const payload = [...chosenGroups].map((sid) => ({
        supplier_id: sid || null, note: notes.trim() || null,
        lines: chosen.filter((l) => (l.row.item.supplier_id ?? '') === sid).map((l) => ({ item_id: l.row.item.id, qty: l.qty, manual: l.manual })),
      }));
      const res = must(await supabase.rpc('place_orders', { p_orders: payload })) as { number: number }[];
      onPlaced(`Placed ${res.map((r, idx) => `${poCode(r.number)} (${payload[idx].supplier_id ? supplierName(payload[idx].supplier_id) : 'no supplier'})`).join(', ')}. They’re now on the Receive tab.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(po: PurchaseOrder, status: 'closed' | 'cancelled') {
    const verb = status === 'cancelled' ? 'Cancel' : 'Close';
    if (!confirm(`${verb} ${poCode(po.number)}? ${status === 'closed' ? 'Anything not yet received is treated as not coming.' : 'Nothing was received on it.'}`)) return;
    setError(null);
    try { must(await supabase.rpc('set_order_status', { p_po: po.id, p_status: status })); await onChanged(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="split">
      <section className="main" style={{ gap: 16 }}>
        <AddItem rows={rows} onAdd={add} scanTitle="Scan to add to the order" placeholder="Search or scan to order something that isn’t low (e.g. a bulk buy)" />
        {noData > 0 && <div className="note small"><div>{noData} items have no usage yet, so they can’t be flagged as low. Add them above if you need them, or <Link to="/inventory-settings">finish their setup</Link>.</div></div>}

        {lines.length === 0 && <div className="card muted">Nothing is low right now{openOrders.length ? ' (items already on order are counted)' : ''}. Search or scan above to order something anyway.</div>}
        {[...groups.entries()].map(([sid, list]) => (
          <div key={sid} className="card flush">
            <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', justifyContent: 'space-between' }}>
              <h2>{sid ? supplierName(sid) : 'No supplier set'}</h2>
              <span className="small muted">{money(list.filter((l) => l.include).reduce((t, l) => t + l.qty * (Number(l.row.item.unit_cost) || 0), 0))}</span>
            </div>
            {list.map(({ row: r, qty, include, manual }) => (
              <div key={r.item.id} className="pick-row" style={{ padding: '10px 16px', opacity: include ? 1 : 0.5 }}>
                <input type="checkbox" aria-label={`Order ${r.item.name}`} checked={include} onChange={(e) => setDraft({ ...draft, [r.item.id]: { qty, manual, include: e.target.checked } })} style={{ width: 18, height: 18 }} />
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{r.item.name} {manual && <span className="pill grey">Added</span>}</div>
                  <div className="small muted">
                    <span className="mono">{r.item.sku}</span> · have {r.wh}{r.onOrder ? ` + ${r.onOrder} on order` : ''}{r.rd.canCalc ? ` · min ${r.mm.min} / max ${r.mm.max}` : ''}
                    {Number(r.item.unit_cost) > 0 ? ` · ${money(qty * Number(r.item.unit_cost))}` : ' · no price'}
                    {r.item.mode === 'box' && r.item.units_per_box ? ` · ${Math.round((qty / r.item.units_per_box) * 10) / 10} bx` : ''}
                  </div>
                  {r.hasBreak && <Link className="small" style={{ fontWeight: 600 }} to={`/bulk?item=${r.item.id}`}>Price break available · check bulk buy</Link>}
                </div>
                <Stepper value={qty} step={boxStep(r.item)} suffix=" pcs" onChange={(v) => setDraft({ ...draft, [r.item.id]: { qty: v, manual, include: include || v > 0 } })} />
              </div>
            ))}
          </div>
        ))}

        {openOrders.length > 0 && (
          <div className="card flush">
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}><h2>Open orders</h2></div>
            {openOrders.map((o) => {
              const done = o.lines.filter((l) => l.qty_received >= l.qty_ordered).length;
              const anyRecv = o.lines.some((l) => l.qty_received > 0);
              return (
                <details key={o.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--line-2)' }}>
                  <summary className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
                    <span><b className="mono">{poCode(o.number)}</b> · {o.supplier_id ? supplierName(o.supplier_id) : 'No supplier'} · {when(o.created_at)} · {done}/{o.lines.length} lines received</span>
                    <span className="row" style={{ gap: 6 }}>
                      <button className="btn sm primary" onClick={(e) => { e.preventDefault(); receive(o.id); }}>Receive</button>
                      {anyRecv
                        ? <button className="btn sm" onClick={(e) => { e.preventDefault(); setStatus(o, 'closed'); }}>Close</button>
                        : <button className="btn sm" onClick={(e) => { e.preventDefault(); setStatus(o, 'cancelled'); }}>Cancel</button>}
                    </span>
                  </summary>
                  <div style={{ paddingTop: 8 }}>
                    {o.lines.map((l) => (
                      <div key={l.id} className="small row" style={{ justifyContent: 'space-between' }}>
                        <span>{itemById(l.item_id)?.name ?? 'Archived item'}{l.added_by_hand ? ' (added)' : ''}</span>
                        <span className="mono">{l.qty_received} / {l.qty_ordered}</span>
                      </div>
                    ))}
                    {o.note && <div className="small muted" style={{ marginTop: 6 }}>{o.note}</div>}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>

      <aside className="side">
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>Place order</h2>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 22 }}>{chosen.length} item{chosen.length === 1 ? '' : 's'} · {money(total)}</div>
          <div className="small muted">{chosenGroups.size > 1 ? `Creates ${chosenGroups.size} orders, one per supplier.` : 'Creates one order.'} Prices without a cost aren’t in the total.</div>
          <div className="field"><label htmlFor="po-note">Note</label><input id="po-note" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. called Hughes, pallet pricing" /></div>
          <ErrorMsg error={error} />
          <button className="btn primary block" disabled={busy || chosen.length === 0} onClick={place}>{busy ? 'Placing…' : chosenGroups.size > 1 ? `Place ${chosenGroups.size} orders` : 'Place order'}</button>
          <div className="small muted">Placing records what you ordered. Send it to the supplier however you normally do.</div>
        </section>
      </aside>
    </div>
  );
}

// ---------------- Receive: what's on open orders, plus anything scanned ----------------
function ReceiveTab({ rows, openOrders, focusPo, onDone }: { rows: Row[]; openOrders: PurchaseOrder[]; focusPo: string | null; onDone: (msg: string) => void }) {
  const { supplierName } = useData();
  const [recv, setRecv] = useState<Record<string, number>>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rowById = new Map(rows.map((r) => [r.item.id, r]));

  // Each item appears once, under the oldest open order it's still outstanding on.
  const sorted = [...openOrders].sort((a, b) => (a.id === focusPo ? -1 : b.id === focusPo ? 1 : a.created_at.localeCompare(b.created_at)));
  const seen = new Set<string>();
  const sections = sorted.map((o) => ({
    order: o,
    lines: o.lines.filter((l) => l.qty_received < l.qty_ordered && !seen.has(l.item_id) && (seen.add(l.item_id), true))
      .map((l) => ({ row: rowById.get(l.item_id), outstanding: rows.length ? (rowById.get(l.item_id)?.onOrder ?? 0) : 0, line: l }))
      .filter((x): x is { row: Row; outstanding: number; line: typeof x.line } => !!x.row),
  })).filter((s) => s.lines.length);
  const extraRows = extra.filter((id) => !seen.has(id)).map((id) => rowById.get(id)).filter((r): r is Row => !!r);

  const add = (r: Row, pieces: number) => {
    const next = (recv[r.item.id] ?? 0) + pieces;
    setRecv((p) => ({ ...p, [r.item.id]: (p[r.item.id] ?? 0) + pieces }));
    if (!seen.has(r.item.id)) setExtra((x) => (x.includes(r.item.id) ? x : [...x, r.item.id]));
    return `+${pieces} ${r.item.sku ?? r.item.name} → ${next}${seen.has(r.item.id) ? '' : ' (not on an order)'}`;
  };
  const lines = Object.entries(recv).filter(([, n]) => n > 0);
  const totalPcs = lines.reduce((t, [, n]) => t + n, 0);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const res = must(await supabase.rpc('receive_delivery', { p_lines: lines.map(([item_id, q]) => ({ item_id, qty: q })), p_po: focusPo, p_note: null })) as { not_on_order: number };
      onDone(`Received ${totalPcs} pieces across ${lines.length} item${lines.length === 1 ? '' : 's'}.${res.not_on_order ? ` ${res.not_on_order} item${res.not_on_order === 1 ? ' was' : 's were'} more than was on order.` : ''}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const lineRow = (r: Row, outstanding?: number) => (
    <div key={r.item.id} className="pick-row" style={{ padding: '10px 16px' }}>
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{r.item.name}</div>
        <div className="small muted"><span className="mono">{r.item.sku}</span> · have {piecesLabel(r.item, r.wh)}{outstanding != null ? ` · expecting ${outstanding}` : ''}</div>
      </div>
      {outstanding != null && <button className="btn sm" onClick={() => setRecv({ ...recv, [r.item.id]: outstanding })}>All {outstanding}</button>}
      <Stepper value={recv[r.item.id] ?? 0} step={boxStep(r.item)} suffix=" pcs" onChange={(v) => setRecv({ ...recv, [r.item.id]: v })} />
    </div>
  );

  return (
    <div className="split">
      <section className="main" style={{ gap: 16 }}>
        <AddItem rows={rows} onAdd={add} scanTitle="Scan the delivery" placeholder="Search or scan anything that arrived" />
        {sections.length === 0 && <div className="card muted">No open orders. Search or scan what arrived to receive it.</div>}
        {sections.map(({ order: o, lines: ls }) => (
          <div key={o.id} className="card flush" style={o.id === focusPo ? { borderColor: 'var(--accent)' } : undefined}>
            <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', justifyContent: 'space-between' }}>
              <h2><span className="mono">{poCode(o.number)}</span> · {o.supplier_id ? supplierName(o.supplier_id) : 'No supplier'}</h2>
              <button className="btn sm" onClick={() => setRecv({ ...recv, ...Object.fromEntries(ls.map((x) => [x.row.item.id, x.outstanding])) })}>Everything arrived</button>
            </div>
            {ls.map((x) => lineRow(x.row, x.outstanding))}
          </div>
        ))}
        {extraRows.length > 0 && (
          <div className="card flush">
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}><h2>Not on an order</h2></div>
            {extraRows.map((r) => lineRow(r))}
          </div>
        )}
      </section>
      <aside className="side">
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>Delivery</h2>
          <div className="small muted">Supplier → warehouse</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 22 }}>{totalPcs} pcs · {lines.length} item{lines.length === 1 ? '' : 's'}</div>
          <div className="small muted">Short? Enter only what came. The rest stays on the order until it arrives or you close the order.</div>
          <ErrorMsg error={error} />
          <button className="btn primary block" disabled={busy || lines.length === 0} onClick={submit}>{busy ? 'Saving…' : 'Receive into warehouse'}</button>
          {lines.length > 0 && <button className="btn block" onClick={() => { setRecv({}); setExtra([]); }}>Clear</button>}
        </section>
      </aside>
    </div>
  );
}
