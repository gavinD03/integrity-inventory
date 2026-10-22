import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import { readiness } from '../lib/readiness';

/** Completion per SKU: what's still missing before the item can be ordered and kept in stock. */
export default function ItemSetup() {
  const { items, supplierName } = useData();
  const nav = useNavigate();
  const [show, setShow] = useState<string>('todo');
  const [search, setSearch] = useState('');
  const rows = items.map((item) => ({ item, rd: readiness(item) }));
  const keys = ['usage', 'price', 'supplier', 'box', 'confirm'] as const;
  const labels: Record<string, string> = { usage: 'usage', price: 'price', supplier: 'supplier', box: 'box qty', confirm: 'to confirm' };
  const missingCount = (k: string) => rows.filter((r) => r.rd.missing.some((m) => m.key === k)).length;
  const complete = rows.filter((r) => r.rd.missing.length === 0).length;
  const doneChecks = rows.reduce((t, r) => t + r.rd.done, 0);
  const allChecks = rows.reduce((t, r) => t + r.rd.total, 0);
  const overall = allChecks ? Math.round((doneChecks / allChecks) * 100) : 0;
  const visible = rows
    .filter((r) => (show === 'all' ? true : show === 'todo' ? r.rd.missing.length > 0 : r.rd.missing.some((m) => m.key === show)))
    .filter((r) => !search || `${r.item.sku ?? ''} ${r.item.name}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.rd.pct - b.rd.pct || (a.item.sku ?? '').localeCompare(b.item.sku ?? ''));

  return (
    <>
      <div className="stats">
        <div className="stat"><div className="label">Setup complete</div><div className="value">{overall}%</div><Bar pct={overall} /></div>
        <div className="stat"><div className="label">Ready to order</div><div className="value">{complete} / {rows.length}</div><div className="small muted">Every required field filled</div></div>
      </div>
      <div className="note small"><div>Required to order and keep an item in stock: <b>usage</b> (drives min/max and reorder), <b>price</b>, <b>supplier</b>, <b>box qty</b> for items bought by the box, and clearing any <b>“to confirm”</b> note. Incomplete items still show on Inventory; until usage is in, they’re never flagged for reorder.</div></div>
      <div className="card flush">
        <div className="row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div className="chips">
            <button className="chip" aria-pressed={show === 'todo'} onClick={() => setShow('todo')}>Incomplete · {rows.length - complete}</button>
            {keys.map((k) => { const n = missingCount(k); return n ? <button key={k} className="chip" aria-pressed={show === k} onClick={() => setShow(k)}>{k === 'confirm' ? 'To confirm' : `No ${labels[k]}`} · {n}</button> : null; })}
            <button className="chip" aria-pressed={show === 'all'} onClick={() => setShow('all')}>All · {rows.length}</button>
          </div>
          <input className="inp" type="search" placeholder="Search SKU or name" aria-label="Search items" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 220, marginLeft: 'auto' }} />
        </div>
        <div className="tbl">
          <table>
            <thead><tr><th>SKU</th><th>Item</th><th style={{ width: 150 }}>Complete</th><th>Missing</th></tr></thead>
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

export function Bar({ pct }: { pct: number }) {
  return (
    <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${pct}%`, background: pct === 100 ? 'var(--accent)' : pct >= 60 ? 'var(--amber)' : 'var(--warn)' }} />
    </div>
  );
}
