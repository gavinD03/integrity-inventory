import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import { readiness } from '../lib/readiness';
import { must, supabase } from '../lib/supabase';
import type { Item } from '../lib/types';
import { ErrorMsg } from './ui';

/** Completion per SKU: what's still missing before the item can be ordered and kept in stock. Select rows to bulk-edit. */
export default function ItemSetup() {
  const { items, suppliers, supplierName, refresh } = useData();
  const nav = useNavigate();
  const [show, setShow] = useState<string>('todo');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkSup, setBulkSup] = useState('');
  const [bulkLead, setBulkLead] = useState('');
  const [bulkBox, setBulkBox] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const rows = items.map((item) => ({ item, rd: readiness(item) }));
  const keys = ['usage', 'price', 'supplier', 'box', 'confirm'] as const;
  const labels: Record<string, string> = { usage: 'No usage', price: 'No price', supplier: 'No supplier', box: 'Box qty unknown', confirm: 'To confirm' };
  const missingCount = (k: string) => rows.filter((r) => r.rd.missing.some((m) => m.key === k)).length;
  const complete = rows.filter((r) => r.rd.missing.length === 0).length;
  const doneChecks = rows.reduce((t, r) => t + r.rd.done, 0);
  const allChecks = rows.reduce((t, r) => t + r.rd.total, 0);
  const overall = allChecks ? Math.round((doneChecks / allChecks) * 100) : 0;
  const visible = rows
    .filter((r) => (show === 'all' ? true : show === 'todo' ? r.rd.missing.length > 0 : r.rd.missing.some((m) => m.key === show)))
    .filter((r) => !search || `${r.item.sku ?? ''} ${r.item.name}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.rd.pct - b.rd.pct || (a.item.sku ?? '').localeCompare(b.item.sku ?? ''));
  const ids = [...picked];
  const allShown = visible.length > 0 && visible.every((r) => picked.has(r.item.id));

  async function bulk(patch: Partial<Item>, done: string) {
    setBusy(true); setError(null); setMsg(null);
    try {
      must(await supabase.from('items').update({ ...patch, updated_at: new Date().toISOString() }).in('id', ids).select('id'));
      await refresh();
      setMsg(done);
      setPicked(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="stats">
        <div className="stat"><div className="label">Setup complete</div><div className="value">{overall}%</div><Bar pct={overall} /></div>
        <div className="stat"><div className="label">Ready to order</div><div className="value">{complete} / {rows.length}</div><div className="small muted">Every required field filled</div></div>
      </div>
      <div className="note small"><div>Required to order and keep an item in stock: <b>usage</b> (drives min/max and reorder), <b>price</b>, <b>supplier</b>, <b>box qty</b> for items bought by the box, and clearing any <b>“to confirm”</b> note. Incomplete items still show on Inventory; until usage is in, they’re never flagged for reorder. Tick items to edit them in bulk.</div></div>
      <ErrorMsg error={error} />
      {msg && <div className="ok-msg">{msg}</div>}

      {picked.size > 0 && (
        <div className="card bulk-bar">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{picked.size} selected</b>
            <button className="btn sm" onClick={() => setPicked(new Set())}>Clear selection</button>
          </div>
          <div className="bulk-grid">
            <div className="bulk-cell">
              <label className="small muted" htmlFor="b-sup">Supplier</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <select id="b-sup" className="inp" value={bulkSup} onChange={(e) => setBulkSup(e.target.value)}>
                  <option value="">Pick a supplier…</option>
                  {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}{s.lead_days != null ? ` (${s.lead_days}d lead)` : ''}</option>)}
                  <option value="none">No supplier</option>
                </select>
                <button className="btn sm primary" disabled={busy || !bulkSup} onClick={() => bulk(
                  bulkSup === 'none' ? { supplier_id: null, supplier: null } : { supplier_id: bulkSup },
                  bulkSup === 'none' ? `Cleared the supplier on ${picked.size} items.` : `Set ${supplierName(bulkSup)} on ${picked.size} items. Prices and lead times came from ${supplierName(bulkSup)} where they have them.`,
                )}>Apply</button>
              </div>
              <div className="small muted">Pulls each item’s latest quoted price and the supplier’s standard lead time.</div>
            </div>
            <div className="bulk-cell">
              <label className="small muted" htmlFor="b-lead">Lead time (days)</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input id="b-lead" className="inp" type="number" min={0} step={1} value={bulkLead} onChange={(e) => setBulkLead(e.target.value)} style={{ maxWidth: 100 }} />
                <button className="btn sm primary" disabled={busy || bulkLead === '' || Number(bulkLead) < 0} onClick={() => bulk({ lead_days: Math.round(Number(bulkLead)) }, `Lead time set to ${Math.round(Number(bulkLead))} days on ${picked.size} items.`)}>Apply</button>
              </div>
            </div>
            <div className="bulk-cell">
              <label className="small muted" htmlFor="b-box">Box qty (pieces per box)</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input id="b-box" className="inp" type="number" min={2} step={1} value={bulkBox} onChange={(e) => setBulkBox(e.target.value)} style={{ maxWidth: 100 }} />
                <button className="btn sm primary" disabled={busy || !(Number(bulkBox) > 1)} onClick={() => bulk({ mode: 'box', units_per_box: Math.round(Number(bulkBox)) }, `${picked.size} items set to boxes of ${Math.round(Number(bulkBox))}.`)}>Apply</button>
                <button className="btn sm" disabled={busy} onClick={() => bulk({ mode: 'box', units_per_box: null }, `${picked.size} items marked bought by the box, qty unknown.`)}>Unknown</button>
              </div>
              <div className="small muted">Sets them to “bought by the box”. Unknown keeps them flagged until you know.</div>
            </div>
          </div>
        </div>
      )}

      <div className="card flush">
        <div className="row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div className="chips">
            <button className="chip" aria-pressed={show === 'todo'} onClick={() => setShow('todo')}>Incomplete · {rows.length - complete}</button>
            {keys.map((k) => { const n = missingCount(k); return n ? <button key={k} className="chip" aria-pressed={show === k} onClick={() => setShow(k)}>{labels[k]} · {n}</button> : null; })}
            <button className="chip" aria-pressed={show === 'all'} onClick={() => setShow('all')}>All · {rows.length}</button>
          </div>
          <input className="inp" type="search" placeholder="Search SKU or name" aria-label="Search items" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 220, marginLeft: 'auto' }} />
        </div>
        <div className="tbl">
          <table>
            <thead><tr>
              <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all shown" checked={allShown} onChange={(e) => setPicked(e.target.checked ? new Set([...picked, ...visible.map((r) => r.item.id)]) : new Set([...picked].filter((id) => !visible.some((r) => r.item.id === id))))} style={{ width: 18, height: 18 }} /></th>
              <th>SKU</th><th>Item</th><th style={{ width: 150 }}>Complete</th><th>Missing</th>
            </tr></thead>
            <tbody>
              {visible.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: 20 }}>{show === 'todo' ? 'Every item is set up.' : 'No items match.'}</td></tr>}
              {visible.map(({ item: i, rd }) => (
                <tr key={i.id} className="click" onClick={() => nav(`/items/${i.id}`)} style={picked.has(i.id) ? { background: 'var(--accent-soft)' } : undefined}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${i.name}`} checked={picked.has(i.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(i.id); else n.delete(i.id); setPicked(n); }} style={{ width: 18, height: 18 }} /></td>
                  <td className="mono">{i.sku ?? '—'}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{i.name}</div>
                    <div className="small muted">{[i.supplier_id ? supplierName(i.supplier_id) : null, i.mode === 'box' && Number(i.units_per_box) > 1 ? `box of ${i.units_per_box}` : null, i.needs_confirm ? `To confirm: ${i.needs_confirm}` : null].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><Bar pct={rd.pct} /><span className="mono small">{rd.pct}%</span></div></td>
                  <td>{rd.missing.length ? <span className="row" style={{ gap: 4 }}>{rd.missing.map((m) => <span key={m.key} className="pill amber">{labels[m.key] ?? m.label}</span>)}</span> : <span className="pill ok">Ready</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export function Bar({ pct }: { pct: number }) {
  return (
    <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${pct}%`, background: pct === 100 ? 'var(--accent)' : pct >= 60 ? 'var(--amber)' : 'var(--warn)' }} />
    </div>
  );
}
