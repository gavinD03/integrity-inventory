import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useData } from '../../../lib/data';
import { must, supabase } from '../../../lib/supabase';
import { quoteWarnings, toNum } from '../../../lib/quoteParse';
import type { QuoteLine, QuoteRound, SupplierQuote } from '../../../lib/types';
import { ErrorMsg } from '../../../components/ui';
import { checkContext, fmt$ } from './shared';

type Field = 'pieces' | 'list' | 'bq' | 'bp' | 'notes';
const LABEL: Record<Field, string> = { pieces: 'Pieces per pack', list: 'List price per pack', bq: 'Bulk qty', bp: 'Bulk price per piece', notes: 'Notes' };
type Entry = Record<Field, string>;

/** Hand entry for suppliers who reply on the PDF. Tab moves across, Enter moves down. */
export default function ManualView({ round, quotes, lines, reload, onSaved }: {
  round: QuoteRound; quotes: SupplierQuote[]; lines: QuoteLine[]; reload: () => Promise<void>; onSaved: () => void;
}) {
  const { suppliers, supplierName, itemById } = useData();
  const withRequests = quotes.filter((q) => lines.some((l) => l.quote_id === q.id && l.requested));
  const [supplierId, setSupplierId] = useState(withRequests[0]?.supplier_id ?? '');
  const quote = quotes.find((q) => q.supplier_id === supplierId);
  const qLines = useMemo(
    () => lines
      .filter((l) => quote && l.quote_id === quote.id && l.item_id && (l.requested || l.list_pack_price != null || l.bulk_unit_price != null))
      .sort((a, b) => (a.sku_raw ?? '').localeCompare(b.sku_raw ?? '')),
    [lines, quote],
  );
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = (v: number | string | null) => (v == null ? '' : String(v));
    setEntries(Object.fromEntries(qLines.map((l) => [l.item_id as string, {
      pieces: s(l.pieces_per_pack), list: s(l.list_pack_price), bq: s(l.bulk_qty), bp: s(l.bulk_unit_price), notes: l.notes ?? '',
    }])));
  }, [qLines]);

  const parsed = (e: Entry | undefined) => {
    const n = (v: string | undefined) => { const x = toNum(v ?? ''); return x == null || Number.isNaN(x) || x < 0 ? null : x; };
    const bad = e ? (['pieces', 'list', 'bq', 'bp'] as Field[]).filter((f) => e[f].trim() && (toNum(e[f]) == null || Number.isNaN(toNum(e[f]) as number))) : [];
    return {
      pieces_per_pack: n(e?.pieces) || null, list_pack_price: n(e?.list), bulk_qty: n(e?.bq) || null, bulk_unit_price: n(e?.bp), notes: e?.notes ?? '',
      bad,
    };
  };

  function onKey(ev: KeyboardEvent<HTMLInputElement>, row: number, col: number) {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const next = document.getElementById(`m-${row + (ev.shiftKey ? -1 : 1)}-${col}`) as HTMLInputElement | null;
    next?.focus();
    next?.select();
  }

  async function save(status: 'draft' | 'saved') {
    if (!quote) return;
    if (status === 'saved' && quote.status === 'saved' && !confirm(`Replace ${supplierName(supplierId)}'s saved prices for ${round.label}?`)) return;
    setBusy(true); setError(null);
    try {
      const payload = qLines.map((l) => {
        const p = parsed(entries[l.item_id as string]);
        return { item_id: l.item_id, sku_raw: l.sku_raw, description_raw: l.description_raw, pieces_per_pack: p.pieces_per_pack, list_pack_price: p.list_pack_price, bulk_qty: p.bulk_qty, bulk_unit_price: p.bulk_unit_price, notes: p.notes, match_status: 'matched' };
      }).filter((x) => x.pieces_per_pack != null || x.list_pack_price != null || x.bulk_qty != null || x.bulk_unit_price != null || x.notes);
      must(await supabase.rpc('save_quote', { p_round: round.id, p_supplier: supplierId, p_file_name: 'Entered by hand', p_lines: payload, p_status: status }));
      await reload();
      if (status === 'saved') onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!withRequests.length) {
    return <div className="card muted">No requests in {round.label} yet. Generate a request first; its items become the grid here.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Enter a PDF reply by hand · {round.label}</h2>
        <div className="chips">
          {withRequests.map((q) => {
            const s = suppliers.find((x) => x.id === q.supplier_id);
            return <button key={q.id} className="chip" aria-pressed={supplierId === q.supplier_id} onClick={() => setSupplierId(q.supplier_id)}>{s?.name ?? '—'} · {q.status}</button>;
          })}
        </div>
        <div className="small muted">Tab moves across, Enter moves down (Shift+Enter up). Leave a row blank if they don't carry it.</div>
      </section>

      {quote && (
        <section className="card flush">
          <div className="tbl">
            <table>
              <thead><tr><th>SKU</th><th>Item</th><th className="num">Pcs/pack</th><th className="num">List/pack $</th><th className="num">$/pc</th><th className="num">Bulk qty</th><th className="num">Bulk $/pc</th><th>Notes</th><th>Warnings</th></tr></thead>
              <tbody>
                {qLines.map((l, row) => {
                  const id = l.item_id as string;
                  const e = entries[id] ?? { pieces: '', list: '', bq: '', bp: '', notes: '' };
                  const p = parsed(e);
                  const it = itemById(id);
                  const w = [
                    ...p.bad.map((f) => `${LABEL[f]} isn't a number`),
                    ...quoteWarnings(p, checkContext(it, supplierId, quotes, lines)),
                  ];
                  const per = p.list_pack_price != null && p.pieces_per_pack ? p.list_pack_price / p.pieces_per_pack : null;
                  return (
                    <tr key={id}>
                      <td className="mono small">{l.sku_raw}</td>
                      <td style={{ minWidth: 180 }}>{it?.name ?? l.description_raw}</td>
                      {(['pieces', 'list', 'bq', 'bp'] as Field[]).map((f, col) => [
                        col === 2 ? <td key="pp" className="num small">{fmt$(per, 4)}</td> : null,
                        <td key={f} className="num">
                          <input id={`m-${row}-${col}`} className="inp mono" inputMode="decimal" aria-label={`${LABEL[f]} for ${it?.name ?? l.sku_raw}`} value={e[f]}
                            onKeyDown={(ev) => onKey(ev, row, col)}
                            onChange={(ev) => setEntries({ ...entries, [id]: { ...e, [f]: ev.target.value } })}
                            style={{ width: 90, textAlign: 'right', minHeight: 38 }} />
                        </td>,
                      ])}
                      <td>
                        <input id={`m-${row}-4`} className="inp" aria-label={`Notes for ${it?.name ?? l.sku_raw}`} value={e.notes}
                          onKeyDown={(ev) => onKey(ev, row, 4)}
                          onChange={(ev) => setEntries({ ...entries, [id]: { ...e, notes: ev.target.value } })} style={{ minWidth: 140, minHeight: 38 }} />
                      </td>
                      <td className="small" style={{ color: w.length ? 'var(--warn)' : undefined, maxWidth: 260 }}>{w.join(' · ') || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <ErrorMsg error={error} />
      <div className="row">
        <button className="btn primary" disabled={busy || !quote} onClick={() => save('saved')}>{busy ? 'Saving…' : 'Save quote'}</button>
        <button className="btn" disabled={busy || !quote} onClick={() => save('draft')}>Save draft</button>
      </div>
    </div>
  );
}
