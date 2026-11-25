import { useState } from 'react';
import type { Item } from '../lib/types';
import { imageUrl } from '../lib/images';
import Scanner from './Scanner';

/** Product photo, or a neutral placeholder with the item's initial. */
export function ItemThumb({ item, size = 44 }: { item: Item; size?: number }) {
  const url = imageUrl(item.image_path);
  const box = { width: size, height: size, borderRadius: 8, flex: 'none' } as const;
  return url
    ? <img src={url} alt="" loading="lazy" style={{ ...box, objectFit: 'cover', background: 'var(--line-2)' }} />
    : <div aria-hidden style={{ ...box, background: 'var(--line-2)', display: 'grid', placeItems: 'center', fontWeight: 700, color: 'var(--muted)' }}>{item.name.slice(0, 1).toUpperCase()}</div>;
}

/**
 * Tech screens: search or scan an item, set the quantity in a pop-up (− / +, individual pieces), then add it.
 * Nothing is added until the tech confirms the quantity.
 */
export default function TechPicker({ items, onAdd, scanTitle, browse, browseLabel, note, max }: {
  items: Item[];
  onAdd: (item: Item, qty: number) => string | null; // returns a message, or null if it couldn't be added
  scanTitle: string;
  browse?: Item[];      // list shown right away, filterable by search and category (e.g. warehouse stock)
  browseLabel?: string;
  note?: (item: Item) => string;
  max?: (item: Item) => number; // most that can be added (e.g. what's left on the truck)
}) {
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const [pending, setPending] = useState<{ item: Item; fromScan: boolean } | null>(null);
  const [qty, setQty] = useState(1);
  const [cat, setCat] = useState('');
  const q = search.trim().toLowerCase();
  // With a browse list, search and category filter that list; search also reaches every other allowed item.
  const pool = q ? items : (browse ?? []);
  const shown = pool
    .filter((i) => !q || `${i.sku ?? ''} ${i.name}`.toLowerCase().includes(q))
    .filter((i) => !cat || (i.category ?? 'Other') === cat)
    .slice(0, q ? 30 : 400);
  const cats = [...new Set((browse ?? items).map((i) => i.category ?? 'Other'))].sort();

  const open = (item: Item, fromScan: boolean) => { setPending({ item, fromScan }); setQty(1); };
  const cap = pending && max ? Math.max(0, max(pending.item)) : Infinity;

  function confirm(scanNext: boolean) {
    if (!pending) return;
    const n = Math.min(cap, Math.max(1, Math.round(qty) || 1));
    setLast(onAdd(pending.item, n));
    setSearch('');
    setPending(null);
    if (scanNext) setScan(true);
  }

  const row = (i: Item) => (
    <button key={i.id} type="button" className="pick-row tap-row" onClick={() => open(i, false)}>
      <ItemThumb item={i} />
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
      {(browse || q) && cats.length > 1 && (
        <div className="chips chip-scroll" role="group" aria-label="Filter by category">
          <button type="button" className="chip" aria-pressed={!cat} onClick={() => setCat('')}>All</button>
          {cats.map((c) => <button key={c} type="button" className="chip" aria-pressed={cat === c} onClick={() => setCat(cat === c ? '' : c)}>{c}</button>)}
        </div>
      )}
      {!q && browse && <div className="small muted" style={{ padding: '2px 2px 0' }}>{browseLabel ?? 'Items'} · {shown.length}</div>}
      {(browse || q) && (shown.length
        ? <div className="browse-list">{shown.map(row)}</div>
        : <div className="small muted" style={{ padding: 8 }}>{q ? `No items match “${search}”.` : 'Nothing here.'}</div>)}

      {scan && <Scanner title={scanTitle} onItem={(r) => {
        if (!items.some((x) => x.id === r.item.id)) return `${r.item.name} can’t be added here`;
        // Stop scanning and ask how many before adding anything.
        setScan(false);
        open(r.item, true);
        return r.item.name;
      }} onClose={() => setScan(false)} />}

      {pending && (
        <div className="scrim" style={{ zIndex: 70, alignItems: "center" }} role="dialog" aria-modal="true" aria-label={`How many ${pending.item.name}`} onClick={() => setPending(null)}>
          <div className="qty-pop" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ flexWrap: 'nowrap', gap: 12, alignItems: 'center' }}>
              <ItemThumb item={pending.item} size={72} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 17 }}>{pending.item.name}</div>
                <div className="small muted">{[pending.item.sku, note?.(pending.item)].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
            {cap <= 0 ? (
              <div className="err">None left to add here.</div>
            ) : (
              <div className="qty-row">
                <button type="button" className="qty-btn" aria-label="One less" disabled={qty <= 1} onClick={() => setQty((v) => Math.max(1, v - 1))}>−</button>
                <input className="qty-inp" type="number" inputMode="numeric" min={1} max={Number.isFinite(cap) ? cap : undefined} aria-label="Quantity in pieces"
                  value={qty} onChange={(e) => setQty(Math.max(0, Math.round(Number(e.target.value) || 0)))} onFocus={(e) => e.target.select()} />
                <button type="button" className="qty-btn" aria-label="One more" disabled={qty >= cap} onClick={() => setQty((v) => Math.min(cap, v + 1))}>+</button>
              </div>
            )}
            <div className="small muted" style={{ textAlign: 'center' }}>Pieces{Number.isFinite(cap) ? ` · ${cap} available` : ''}</div>
            <button type="button" className="btn primary block" disabled={cap <= 0 || qty < 1} onClick={() => confirm(false)}>Add {Math.min(cap, Math.max(1, qty))}</button>
            {pending.fromScan && <button type="button" className="btn block" disabled={cap <= 0 || qty < 1} onClick={() => confirm(true)}>Add &amp; scan next</button>}
            <button type="button" className="btn block" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
