import { useState } from 'react';
import { useData } from '../lib/data';
import { must, supabase } from '../lib/supabase';
import { buildLabelPdf, THERMAL_203_MAX_SKU, type LabelFormat } from '../lib/labels';
import { sizeText } from '../lib/sku';
import { download } from '../lib/sheets';
import type { Item } from '../lib/types';
import { ErrorMsg, Sheet, Stepper } from './ui';

/** Bin labels: Code 128 of the SKU. Printing locks each item's SKU so labels never go stale. */
export default function LabelPrint({ items, onClose }: { items: Item[]; onClose: () => void }) {
  const { skuCodes, refresh } = useData();
  const printable = items.filter((i) => i.sku);
  const noSku = items.filter((i) => !i.sku);
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(printable.map((i) => [i.id, 1])));
  const [format, setFormat] = useState<LabelFormat>('avery5160');
  const [skip, setSkip] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const total = printable.reduce((t, i) => t + (qty[i.id] ?? 0), 0);
  const longSkus = printable.filter((i) => (qty[i.id] ?? 0) > 0 && (i.sku ?? '').length > THERMAL_203_MAX_SKU);

  async function print() {
    setBusy(true); setError(null);
    try {
      const labels = printable.flatMap((i) => Array.from({ length: qty[i.id] ?? 0 }, () => ({
        sku: i.sku as string,
        name: i.name,
        size: sizeText(i.sku as string, skuCodes),
      })));
      const pdf = await buildLabelPdf(labels, format, format === 'avery5160' ? skip : 0);
      download(pdf, `IWT_labels_${format === 'avery5160' ? 'Avery5160' : '2x1'}_${new Date().toISOString().slice(0, 10)}.pdf`);
      const ids = printable.filter((i) => (qty[i.id] ?? 0) > 0).map((i) => i.id);
      must(await supabase.rpc('mark_labels_printed', { p_items: ids }));
      await refresh();
      setDone(`${labels.length} labels generated. ${ids.length} SKU${ids.length === 1 ? ' is' : 's are'} now locked.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Print bin labels" sub="Code 128 of the SKU · for warehouse and truck bins" onClose={onClose}
      foot={done ? <button className="btn dark block" onClick={onClose}>Done</button> : (
        <>
          <ErrorMsg error={error} />
          <button className="btn primary block" disabled={busy || total === 0} onClick={print}>{busy ? 'Building PDF…' : `Download ${total} label${total === 1 ? '' : 's'} (PDF)`}</button>
        </>
      )}>
      {done ? <div className="ok-msg" style={{ margin: '8px 0' }}>{done} Print at 100% / “Actual size” (not “Fit to page”).</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '6px 0' }}>
          <div className="chips" role="group" aria-label="Label format">
            <button className="chip" aria-pressed={format === 'avery5160'} onClick={() => setFormat('avery5160')}>Avery 5160 sheet (30/page)</button>
            <button className="chip" aria-pressed={format === 'thermal2x1'} onClick={() => setFormat('thermal2x1')}>2" × 1" thermal</button>
          </div>
          {format === 'avery5160' && (
            <label className="row small" style={{ gap: 8 }}>
              Skip the first
              <input className="inp mono" type="number" min={0} max={29} value={skip} onChange={(e) => setSkip(Math.max(0, Math.min(29, Number(e.target.value) || 0)))} style={{ width: 70, minHeight: 36 }} />
              labels (for a partly used sheet)
            </label>
          )}
          {format === 'thermal2x1' && longSkus.length > 0 && (
            <div className="err">
              {longSkus.length} SKU{longSkus.length === 1 ? ' is' : 's are'} longer than {THERMAL_203_MAX_SKU} characters ({longSkus.slice(0, 3).map((i) => i.sku).join(', ')}{longSkus.length > 3 ? '…' : ''}). In testing these didn’t scan reliably on a 203 dpi printer. Use a 300 dpi thermal printer or Avery sheets for them.
            </div>
          )}
          <div className="small muted">Printing locks each SKU: it can’t be renamed afterwards, so printed labels never go stale.</div>
          {printable.map((i) => (
            <div key={i.id} className="pick-row">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{i.name}</div>
                <div className="small muted mono">{i.sku}{i.label_printed_at ? ' · printed before' : ''}</div>
              </div>
              <Stepper value={qty[i.id] ?? 0} onChange={(v) => setQty({ ...qty, [i.id]: v })} />
            </div>
          ))}
          {noSku.length > 0 && <div className="err">{noSku.length} selected item{noSku.length === 1 ? ' has' : 's have'} no SKU and can’t get a label: {noSku.map((i) => i.name).join(', ')}.</div>}
        </div>
      )}
    </Sheet>
  );
}
