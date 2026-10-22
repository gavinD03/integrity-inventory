import { useMemo, useState } from 'react';
import { useData } from '../lib/data';
import { must, supabase } from '../lib/supabase';
import { code128Bits } from '../lib/labels';
import { freeSku, normalizeSku, validSku } from '../lib/sku';
import type { Item } from '../lib/types';
import Scanner from './Scanner';
import LabelPrint from './LabelPrint';
import { ErrorMsg } from './ui';

export interface QueuedBarcode { code: string; pieces: number; label: string }

/** Code 128 preview drawn as SVG bars. */
export function BarcodeSvg({ value, height = 56 }: { value: string; height?: number }) {
  const bits = useMemo(() => { try { return code128Bits(value); } catch { return null; } }, [value]);
  if (!bits) return <div className="err">Can’t encode “{value}” as a barcode.</div>;
  const quiet = 10;
  const w = bits.length + quiet * 2;
  const rects: JSX.Element[] = [];
  let run = 0;
  for (let i = 0; i <= bits.length; i++) {
    if (i < bits.length && bits[i] === '1') { run++; continue; }
    if (run) rects.push(<rect key={i} x={quiet + i - run} y={0} width={run} height={height} />);
    run = 0;
  }
  return (
    <svg role="img" aria-label={`Barcode for ${value}`} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', maxWidth: 360, height, background: '#fff', display: 'block' }}>
      <g fill="#000">{rects}</g>
    </svg>
  );
}

/** Suggests a SKU when the dropdowns weren't used: category code + first word of the name, made unique. */
function suggestSku(item: Item, categoryCode: string | null, taken: string[]): string {
  const cat = categoryCode ?? (normalizeSku(item.category ?? '').replace(/-/g, '').slice(0, 3) || 'ITM');
  const word = normalizeSku(item.name).split('-').find((w) => w.length >= 2) ?? 'ITEM';
  return freeSku(`${cat}-${word.slice(0, 8)}`, taken);
}

/**
 * Two kinds of barcode per item:
 *  1. Ours — Code 128 of the SKU, printed as bin labels.
 *  2. Manufacturers' — UPC/EAN from packaging, linked here (never generated).
 * On a new, unsaved item, manufacturer barcodes are queued and linked when the item is saved.
 */
export default function ItemBarcodes({ item, saved, formSku, onSkuChange, queued, onQueue }: {
  item: Item;                 // current form values
  saved: Item | undefined;    // last saved version (undefined for a new item)
  formSku: string | null;
  onSkuChange: (sku: string) => void;
  queued: QueuedBarcode[];
  onQueue: (q: QueuedBarcode[]) => void;
}) {
  const { barcodes, isManager, refresh, items, skuCodes } = useData();
  const mine = saved ? barcodes.filter((b) => b.item_id === saved.id) : [];
  const [code, setCode] = useState('');
  const [pieces, setPieces] = useState<number>(item.mode === 'box' && item.units_per_box ? item.units_per_box : 1);
  const [label, setLabel] = useState('');
  const [scanning, setScanning] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skuOk = !!formSku && validSku(formSku);
  const skuSaved = !!saved && !!saved.sku && saved.sku === formSku;

  async function generateSku() {
    setError(null);
    const { data } = await supabase.from('items').select('sku').not('sku', 'is', null);
    const taken = ((data as { sku: string }[]) ?? []).map((r) => r.sku).concat(items.map((i) => i.sku ?? '').filter(Boolean));
    const catCode = skuCodes.find((c) => c.segment === 'category' && c.label.toLowerCase() === (item.category ?? '').trim().toLowerCase())?.code ?? null;
    onSkuChange(suggestSku(item, catCode, taken));
  }

  async function link() {
    const c = code.trim();
    if (!c) return;
    if (formSku && c.toUpperCase() === formSku.toUpperCase()) { setError('That’s this item’s own SKU barcode — it already scans without linking.'); return; }
    setError(null);
    if (!saved) {
      if (queued.some((q) => q.code === c)) { setError('Already queued.'); return; }
      const other = barcodes.find((b) => b.code === c);
      if (other) { setError(`Barcode ${c} is already linked to ${items.find((i) => i.id === other.item_id)?.name ?? 'another item'}.`); return; }
      onQueue([...queued, { code: c, pieces, label }]);
      setCode(''); setLabel('');
      return;
    }
    setBusy(true);
    try {
      must(await supabase.rpc('link_barcode', { p_item: saved.id, p_code: c, p_pieces: pieces, p_label: label }));
      setCode(''); setLabel('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, c: string) {
    if (!confirm(`Unlink barcode ${c}? Scans of it will stop finding this item.`)) return;
    const { error } = await supabase.from('item_barcodes').delete().eq('id', id);
    if (error) setError(error.message);
    await refresh();
  }

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2>Barcodes</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontWeight: 600 }}>Our barcode (from the SKU)</div>
        {skuOk ? (
          <>
            <BarcodeSvg value={formSku!} />
            <div className="mono small">{formSku}</div>
            <div className="row">
              {skuSaved
                ? <button type="button" className="btn primary sm" onClick={() => setPrinting(true)}>Print label</button>
                : <span className="small muted">Save the item to print this label.</span>}
              {saved?.label_printed_at && <span className="small muted">Last printed {new Date(saved.label_printed_at).toLocaleDateString()}</span>}
            </div>
          </>
        ) : (
          <>
            <div className="small muted">No SKU yet, so there’s nothing to encode. Pick codes in the SKU builder above, type a SKU, or generate one.</div>
            {isManager && <div><button type="button" className="btn sm" onClick={generateSku}>Generate a SKU</button></div>}
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--line-2)', paddingTop: 12 }}>
        <div style={{ fontWeight: 600 }}>Manufacturer barcodes</div>
        <div className="small muted">From the packaging (UPC/EAN). One item can have several: different brands, box vs. piece.</div>
        {(mine.length > 0 || queued.length > 0) && (
          <div className="kv">
            {mine.map((b) => (
              <div key={b.id}>
                <span style={{ textAlign: 'left' }}>{b.code}{b.label ? <span className="small muted" style={{ fontFamily: 'inherit' }}> · {b.label}</span> : null}</span>
                <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <span>{b.pieces_per_scan} {b.pieces_per_scan === 1 ? 'pc' : 'pcs'}/scan</span>
                  {isManager && <button className="btn sm" onClick={() => remove(b.id, b.code)}>Unlink</button>}
                </span>
              </div>
            ))}
            {queued.map((q) => (
              <div key={q.code}>
                <span style={{ textAlign: 'left' }}>{q.code}<span className="small muted" style={{ fontFamily: 'inherit' }}> · links when saved{q.label ? ` · ${q.label}` : ''}</span></span>
                <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <span>{q.pieces} {q.pieces === 1 ? 'pc' : 'pcs'}/scan</span>
                  <button className="btn sm" onClick={() => onQueue(queued.filter((x) => x.code !== q.code))}>Remove</button>
                </span>
              </div>
            ))}
          </div>
        )}
        {isManager && (
          <div className="grid2" style={{ alignItems: 'end' }}>
            <div className="field">
              <label htmlFor="bc-code">Barcode</label>
              <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                <input id="bc-code" className="mono" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.trim())} placeholder="Scan or type" />
                <button type="button" className="btn sm" onClick={() => setScanning(true)}>Scan</button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="bc-pcs">Pieces per scan</label>
              <input id="bc-pcs" type="number" min={1} value={pieces} onChange={(e) => setPieces(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div className="field">
              <label htmlFor="bc-label">Label (optional)</label>
              <input id="bc-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Spears box of 50" />
            </div>
            <button type="button" className="btn" disabled={busy || !code} onClick={link}>{busy ? 'Linking…' : saved ? 'Link barcode' : 'Add (links on save)'}</button>
          </div>
        )}
      </div>

      <ErrorMsg error={error} />
      {scanning && <Scanner title="Scan the package barcode" onCapture={(c) => { setCode(c); setScanning(false); }} onClose={() => setScanning(false)} />}
      {printing && saved && <LabelPrint items={[saved]} onClose={() => { setPrinting(false); refresh(); }} />}
    </section>
  );
}
