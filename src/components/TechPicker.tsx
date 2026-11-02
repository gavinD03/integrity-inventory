import { useState } from 'react';
import type { Item } from '../lib/types';
import Scanner from './Scanner';

/**
 * Tech screens: search or scan, tap a result, and it lands in the list below with a ± stepper.
 * Always individual pieces: every tap and every scan adds 1, never a box.
 */
export default function TechPicker({ items, onAdd, scanTitle, quick, quickLabel, note }: {
  items: Item[];
  onAdd: (item: Item) => string | null; // returns a message, or null if it couldn't be added
  scanTitle: string;
  quick?: Item[];       // optional tap-to-add list shown when not searching (e.g. what's on the truck)
  quickLabel?: string;
  note?: (item: Item) => string;
}) {
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const q = search.trim().toLowerCase();
  const matches = q ? items.filter((i) => `${i.sku ?? ''} ${i.name}`.toLowerCase().includes(q)).slice(0, 8) : [];

  const add = (i: Item) => { const m = onAdd(i); setLast(m); setSearch(''); return m; };

  const row = (i: Item) => (
    <button key={i.id} type="button" className="pick-row tap-row" onClick={() => add(i)}>
      <div className="grow" style={{ textAlign: 'left' }}>
        <div style={{ fontWeight: 600 }}>{i.name}</div>
        <div className="small muted">{[i.sku, note?.(i)].filter(Boolean).join(' · ')}</div>
      </div>
      <span className="btn sm primary" aria-hidden>Add</span>
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 0' }}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input className="inp" type="search" placeholder="Search SKU or name" aria-label="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className="btn primary" onClick={() => setScan(true)}>Scan</button>
      </div>
      {last && <div className="small ok-msg">{last}</div>}
      {q && (matches.length ? matches.map(row) : <div className="small muted" style={{ padding: 8 }}>No items match “{search}”.</div>)}
      {!q && quick && quick.length > 0 && (
        <details>
          <summary className="small muted" style={{ cursor: 'pointer', padding: '6px 0' }}>{quickLabel ?? 'Show all'} ({quick.length})</summary>
          {quick.map(row)}
        </details>
      )}
      {scan && <Scanner title={scanTitle} onItem={(r) => {
        if (!items.some((x) => x.id === r.item.id)) return `${r.item.name} can’t be added here`;
        const m = onAdd(r.item);
        setLast(m);
        return m ?? `${r.item.name} not added`;
      }} onClose={() => setScan(false)} />}
    </div>
  );
}
