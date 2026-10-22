import { useState } from 'react';
import { useData } from '../lib/data';
import { must, supabase } from '../lib/supabase';
import type { Item } from '../lib/types';
import Scanner from './Scanner';
import { ErrorMsg } from './ui';

/** Manufacturer barcodes (UPC/EAN) linked to an item. The app never makes these up; they come off packaging. */
export default function ItemBarcodes({ item }: { item: Item }) {
  const { barcodes, isManager, refresh } = useData();
  const mine = barcodes.filter((b) => b.item_id === item.id);
  const [code, setCode] = useState('');
  const [pieces, setPieces] = useState<number>(item.mode === 'box' && item.units_per_box ? item.units_per_box : 1);
  const [label, setLabel] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link() {
    setBusy(true); setError(null);
    try {
      must(await supabase.rpc('link_barcode', { p_item: item.id, p_code: code, p_pieces: pieces, p_label: label }));
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
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2>Barcodes</h2>
      <div className="small muted">
        Bin label: <span className="mono">{item.sku ?? 'no SKU yet'}</span> (Code 128, scans as 1 piece{item.label_printed_at ? `, printed ${new Date(item.label_printed_at).toLocaleDateString()}` : ''}).
        Link manufacturer barcodes from the packaging below — one item can have several (different brands, box vs. piece).
      </div>
      {mine.length > 0 && (
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
        </div>
      )}
      {isManager && (
        <>
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
            <button className="btn" disabled={busy || !code} onClick={link}>{busy ? 'Linking…' : 'Link barcode'}</button>
          </div>
          <ErrorMsg error={error} />
        </>
      )}
      {scanning && <Scanner title="Scan the package barcode" onCapture={(c) => { setCode(c); setScanning(false); }} onClose={() => setScanning(false)} />}
    </section>
  );
}
