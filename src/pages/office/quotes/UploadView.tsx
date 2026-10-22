import { useMemo, useState } from 'react';
import { useData } from '../../../lib/data';
import { must, supabase } from '../../../lib/supabase';
import { bulkSavingsPct, normSku, parseQuoteRows, quoteWarnings, type ParsedQuoteRow } from '../../../lib/quoteParse';
import { readSheet } from '../../../lib/sheets';
import type { QuoteLine, QuoteRound, SupplierQuote } from '../../../lib/types';
import { ErrorMsg } from '../../../components/ui';
import { checkContext, fmt$ } from './shared';

type Match = 'matched' | 'unmatched' | 'manual' | 'ignored';
interface Row extends ParsedQuoteRow { itemId: string | null; match: Match }

export default function UploadView({ round, quotes, lines, reload, onSaved }: {
  round: QuoteRound; quotes: SupplierQuote[]; lines: QuoteLine[]; reload: () => Promise<void>; onSaved: () => void;
}) {
  const { items, suppliers, supplierName, itemById } = useData();
  const [supplierId, setSupplierId] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<{ headerRow: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const skuMap = useMemo(() => new Map(items.filter((i) => i.sku).map((i) => [normSku(i.sku), i.id])), [items]);
  const existing = quotes.find((q) => q.supplier_id === supplierId);
  const requestedIds = new Set(lines.filter((l) => existing && l.quote_id === existing.id && l.requested && l.item_id).map((l) => l.item_id as string));

  async function onFile(f: File) {
    setError(null); setMsg(null); setRows(null);
    try {
      const cells = await readSheet(f);
      const p = parseQuoteRows(cells);
      if (p.error) throw new Error(p.error);
      setFileName(f.name);
      setMeta({ headerRow: p.headerRow, skipped: p.skipped });
      setRows(p.rows.map((r) => {
        const id = skuMap.get(normSku(r.sku_raw)) ?? null;
        return { ...r, itemId: id, match: id ? 'matched' : 'unmatched' };
      }));
    } catch (e) {
      setError(`Couldn't read ${f.name}: ${(e as Error).message}`);
    }
  }

  const setRow = (idx: number, patch: Partial<Row>) => setRows((rs) => rs && rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const unmatched = (rows ?? []).map((r, idx) => ({ r, idx })).filter(({ r }) => r.match === 'unmatched');
  const usedIds = new Set((rows ?? []).map((r) => r.itemId).filter(Boolean));
  const kept = (rows ?? []).filter((r) => r.match !== 'ignored');
  const blankRequested = [...requestedIds].filter((id) => !(rows ?? []).some((r) => r.itemId === id)).length;

  async function save() {
    if (!rows || !supplierId) return;
    if (existing?.status === 'saved' && !confirm(`${supplierName(supplierId)} already has a saved quote for ${round.label}. Replace its prices with this file?`)) return;
    setBusy(true); setError(null);
    try {
      const payload = rows.map((r) => ({
        item_id: r.match === 'ignored' ? null : r.itemId,
        sku_raw: r.sku_raw, description_raw: r.description_raw,
        pieces_per_pack: r.pieces_per_pack, list_pack_price: r.list_pack_price, list_unit_price: r.list_unit_price,
        bulk_qty: r.bulk_qty, bulk_unit_price: r.bulk_unit_price, notes: r.notes,
        match_status: r.match,
      }));
      const res = must(await supabase.rpc('save_quote', { p_round: round.id, p_supplier: supplierId, p_file_name: fileName, p_lines: payload, p_status: 'saved' })) as { lines: number };
      await reload();
      setMsg(`Saved ${res.lines} lines for ${supplierName(supplierId)}.`);
      setRows(null);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Upload a returned sheet · {round.label}</h2>
        <div className="chips">
          {suppliers.filter((s) => s.active || quotes.some((q) => q.supplier_id === s.id)).map((s) => {
            const q = quotes.find((x) => x.supplier_id === s.id);
            return <button key={s.id} className="chip" aria-pressed={supplierId === s.id} onClick={() => setSupplierId(s.id)}>{s.name}{q ? ` · ${q.status}` : ''}</button>;
          })}
        </div>
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
          style={{ border: `2px dashed ${drag ? 'var(--accent)' : 'var(--field)'}`, borderRadius: 10, padding: 24, textAlign: 'center', background: drag ? 'var(--accent-soft)' : '#fafbf9', cursor: 'pointer' }}
        >
          <input type="file" accept=".xlsx,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
          <b>Drop the .xlsx or .csv here</b> or click to choose
          <div className="small muted">The header row is found automatically; column order doesn't matter.</div>
        </label>
        <ErrorMsg error={error} />
        {msg && <div className="ok-msg">{msg}</div>}
      </section>

      {rows && meta && (
        <>
          <div className="stats">
            <div className="stat"><div className="label">Rows with answers</div><div className="value">{rows.length}</div><div className="small muted">Header found on row {meta.headerRow}</div></div>
            <div className="stat"><div className="label">Matched by SKU</div><div className="value">{rows.filter((r) => r.match === 'matched' || r.match === 'manual').length}</div></div>
            <div className="stat"><div className="label">Unmatched</div><div className={`value ${unmatched.length ? 'warn' : ''}`}>{unmatched.length}</div></div>
            <div className="stat"><div className="label">Skipped (blank)</div><div className="value">{meta.skipped}</div><div className="small muted">{supplierId && existing?.status !== undefined ? `${blankRequested} requested items left blank` : 'Supplier doesn’t carry'}</div></div>
          </div>

          {unmatched.length > 0 && (
            <section className="card flush">
              <div style={{ padding: '14px 16px' }}><h2>Unmatched rows</h2><p className="small muted" style={{ margin: '4px 0 0' }}>Map each to an item or ignore it. Unresolved rows are saved as unmatched and left out of the comparison.</p></div>
              <div className="tbl">
                <table>
                  <thead><tr><th>Row</th><th>Their SKU</th><th>Their description</th><th>Map to item</th><th></th></tr></thead>
                  <tbody>
                    {unmatched.map(({ r, idx }) => (
                      <tr key={idx}>
                        <td className="mono">{r.row}</td>
                        <td className="mono">{r.sku_raw || '—'}</td>
                        <td>{r.description_raw || '—'}</td>
                        <td>
                          <input className="inp" list={`items-${idx}`} placeholder="Type SKU or name" aria-label="Map to item"
                            onChange={(e) => {
                              const v = e.target.value;
                              const hit = items.find((i) => `${i.sku ?? ''} · ${i.name}` === v);
                              if (hit) setRow(idx, { itemId: hit.id, match: 'manual' });
                            }} />
                          <datalist id={`items-${idx}`}>
                            {items.filter((i) => !usedIds.has(i.id)).map((i) => <option key={i.id} value={`${i.sku ?? ''} · ${i.name}`} />)}
                          </datalist>
                        </td>
                        <td><button className="btn sm" onClick={() => setRow(idx, { match: 'ignored', itemId: null })}>Ignore</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card flush">
            <div style={{ padding: '14px 16px' }}><h2>Preview</h2><p className="small muted" style={{ margin: '4px 0 0' }}>Warnings don't block saving.</p></div>
            <div className="tbl">
              <table>
                <thead><tr><th>Row</th><th>Item</th><th className="num">Box qty</th><th className="num">Retail each</th><th className="num">Bulk each</th><th className="num">Bulk qty</th><th className="num">Bulk savings</th><th>Warnings</th><th></th></tr></thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const it = r.itemId ? itemById(r.itemId) : undefined;
                    const w = [...r.issues, ...quoteWarnings(r, checkContext(it, supplierId, quotes, lines))];
                    const sav = bulkSavingsPct(r.list_unit_price, r.bulk_unit_price);
                    return (
                      <tr key={idx} style={r.match === 'ignored' ? { opacity: 0.5 } : undefined}>
                        <td className="mono">{r.row}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{it?.name ?? r.description_raw ?? '—'}</div>
                          <div className="small muted mono">{r.sku_raw}{r.match === 'manual' ? ' · mapped by hand' : r.match === 'unmatched' ? ' · unmatched' : r.match === 'ignored' ? ' · ignored' : ''}</div>
                        </td>
                        <td className="num">{r.pieces_per_pack ?? '—'}</td>
                        <td className="num">{fmt$(r.list_unit_price, 4)}</td>
                        <td className="num">{fmt$(r.bulk_unit_price, 4)}</td>
                        <td className="num">{r.bulk_qty ?? '—'}</td>
                        <td className="num">{sav == null ? '—' : `${sav.toFixed(1)}%`}</td>
                        <td className="small" style={{ color: w.length ? 'var(--warn)' : undefined, maxWidth: 320 }}>{w.join(' · ') || '—'}</td>
                        <td>{r.match === 'ignored'
                          ? <button className="btn sm" onClick={() => setRow(idx, { match: r.itemId ? 'manual' : 'unmatched' })}>Undo</button>
                          : <button className="btn sm" onClick={() => setRow(idx, { match: 'ignored', itemId: null })}>Ignore</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="row">
            <button className="btn primary" disabled={busy || !supplierId || kept.length === 0} onClick={save}>
              {busy ? 'Saving…' : !supplierId ? 'Pick the supplier first' : existing?.status === 'saved' ? `Replace ${supplierName(supplierId)}'s quote` : `Save ${supplierName(supplierId)}'s quote`}
            </button>
            <button className="btn" onClick={() => setRows(null)}>Discard</button>
          </div>
        </>
      )}
    </div>
  );
}
