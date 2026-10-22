import { useEffect, useMemo, useState } from 'react';
import { useData } from '../lib/data';
import { must, supabase } from '../lib/supabase';
import { normSku, parseItemRows, type ParsedItemRow } from '../lib/quoteParse';
import { readSheet } from '../lib/sheets';
import { ErrorMsg, Sheet } from './ui';

/** Imports the Items tab of IWT_Inventory_Master.xlsx. Matches existing items by SKU (updates) and adds the rest. */
export default function ItemImport({ file, onClose }: { file: File; onClose: () => void }) {
  const { items, refresh } = useData();
  const [rows, setRows] = useState<ParsedItemRow[] | null>(null);
  const [headerRow, setHeaderRow] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [includeUnconfirmed, setIncludeUnconfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    readSheet(file, /^items$/i)
      .then((cells) => {
        const r = parseItemRows(cells);
        if (r.error) setError(r.error);
        setRows(r.rows);
        setHeaderRow(r.headerRow);
      })
      .catch((e) => setError((e as Error).message));
  }, [file]);

  const existing = useMemo(() => new Map(items.map((i) => [normSku(i.sku), i])), [items]);
  const usable = (rows ?? []).filter((r) => r.values.sku && r.values.name && (r.confirmed || includeUnconfirmed));
  const dupSkus = (() => {
    const seen = new Map<string, number>();
    for (const r of usable) seen.set(normSku(r.values.sku), (seen.get(normSku(r.values.sku)) ?? 0) + 1);
    return [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s);
  })();
  const updates = usable.filter((r) => existing.has(normSku(r.values.sku)));
  const inserts = usable.filter((r) => !existing.has(normSku(r.values.sku)));
  const unconfirmed = (rows ?? []).filter((r) => !r.confirmed).length;
  const withIssues = (rows ?? []).filter((r) => r.issues.length > 0);

  async function run() {
    setBusy(true); setError(null);
    try {
      if (dupSkus.length) throw new Error(`Duplicate SKUs in the sheet: ${dupSkus.join(', ')}`);
      for (const r of updates) {
        const id = existing.get(normSku(r.values.sku))!.id;
        must(await supabase.from('items').update({ ...r.values, updated_at: new Date().toISOString() }).eq('id', id).select('id'));
      }
      if (inserts.length) {
        must(await supabase.from('items').insert(inserts.map((r) => ({ ...r.values, usage_source: 'master sheet' }))).select('id'));
      }
      await refresh();
      setDone(`Imported ${inserts.length} new and updated ${updates.length} existing items.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Import items"
      sub={`${file.name}${headerRow > 0 ? ` · headers on row ${headerRow}` : ''}`}
      onClose={onClose}
      foot={done
        ? <button className="btn dark block" onClick={onClose}>Done</button>
        : <><ErrorMsg error={error} /><button className="btn primary block" disabled={busy || !usable.length || dupSkus.length > 0} onClick={run}>{busy ? 'Importing…' : `Import ${usable.length} items`}</button></>}
    >
      {done ? <div className="ok-msg" style={{ margin: '8px 0' }}>{done} Unit costs aren't in the sheet — set them from the Quotes tab or on each item.</div> : !rows ? <div className="muted" style={{ padding: 12 }}>Reading…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0' }}>
          <div className="kv">
            <div><span style={{ fontFamily: 'inherit' }}>Rows found</span><span>{rows.length}</span></div>
            <div><span style={{ fontFamily: 'inherit' }}>New items</span><span>{inserts.length}</span></div>
            <div><span style={{ fontFamily: 'inherit' }}>Updates (matched by SKU)</span><span>{updates.length}</span></div>
            <div><span style={{ fontFamily: 'inherit' }}>Not "Confirmed"</span><span>{unconfirmed}</span></div>
          </div>
          {unconfirmed > 0 && (
            <label className="check"><input type="checkbox" checked={includeUnconfirmed} onChange={(e) => setIncludeUnconfirmed(e.target.checked)} /> Include {unconfirmed} rows that aren't "Confirmed"</label>
          )}
          {dupSkus.length > 0 && <div className="err">Duplicate SKUs: {dupSkus.join(', ')}. SKUs must be unique; fix the sheet and re-upload.</div>}
          {withIssues.length > 0 && (
            <div className="card" style={{ padding: 12 }}>
              <b>{withIssues.length} rows with warnings</b>
              <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {withIssues.slice(0, 30).map((r) => <li key={r.row}>Row {r.row} ({r.values.sku || r.values.name}): {r.issues.join('; ')}</li>)}
              </ul>
            </div>
          )}
          <div className="small muted">Mapping: SKU, Description → name, Category, Track by → each/box, Stock strategy → truck/warehouse/job, Owner, Pieces / box, Est. annual use ÷ 12 → monthly usage, Min/Max override (e.g. "2/4"), Truck par, Notes → override note.</div>
        </div>
      )}
    </Sheet>
  );
}
