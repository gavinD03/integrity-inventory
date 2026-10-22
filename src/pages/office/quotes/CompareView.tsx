import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../../lib/data';
import { supabase } from '../../../lib/supabase';
import { annualSpend, buildComparison, compareCsv, overpayByCategory, supplierSpend, type CompareRow, type SupplierCell } from '../../../lib/quoteCompare';
import { download, safeName } from '../../../lib/sheets';
import { money, when } from '../../../lib/format';
import type { Item, QuoteLine, QuoteRound, SupplierQuote } from '../../../lib/types';
import { ErrorMsg } from '../../../components/ui';
import { fmt$ } from './shared';

type Sort = 'overpay' | 'gap' | 'spend' | 'sku';

interface LogRow { id: string; item_id: string; field: string; old_value: string | null; new_value: string | null; changed_at: string; source_quote_line_id: string | null }

export default function CompareView({ round, quotes, lines, reload, loading }: {
  round: QuoteRound; quotes: SupplierQuote[]; lines: QuoteLine[]; reload: () => Promise<void>; loading: boolean;
}) {
  const { items, suppliers, settings, supplierName, itemById, refresh } = useData();
  const nav = useNavigate();
  const inRound = suppliers.filter((s) => quotes.some((q) => q.supplier_id === s.id));
  const savedIds = quotes.filter((q) => q.status === 'saved').map((q) => q.supplier_id);
  const [selected, setSelected] = useState<string[]>(savedIds);
  useEffect(() => { setSelected(quotes.filter((q) => q.status === 'saved').map((q) => q.supplier_id)); }, [quotes]);
  const [cat, setCat] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [coverage, setCoverage] = useState(false);
  const [sort, setSort] = useState<Sort>('overpay');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);

  const loadLog = async () => {
    const { data } = await supabase.from('price_change_log').select('*').order('changed_at', { ascending: false }).limit(25);
    setLog((data as LogRow[]) ?? []);
  };
  useEffect(() => { loadLog(); }, []);

  const rows = useMemo(() => buildComparison(items, inRound, quotes, lines, settings.quote_gap_flag_pct), [items, inRound, quotes, lines, settings]);
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean) as string[])].sort();
  const visible = rows
    .filter((r) => (!cat || r.item.category === cat) && (!flaggedOnly || r.flagged) && (!coverage || (selected.length > 0 && selected.every((s) => r.cells[s]?.list != null))))
    .filter((r) => Object.values(r.cells).some((c) => c.state !== 'not_asked') || r.bestList)
    .sort((a, b) =>
      sort === 'overpay' ? b.overpay - a.overpay || (b.gapPct ?? -1e9) - (a.gapPct ?? -1e9)
      : sort === 'gap' ? (b.gapPct ?? -1e9) - (a.gapPct ?? -1e9)
      : sort === 'spend' ? annualSpend(b.item) - annualSpend(a.item)
      : (a.item.sku ?? '').localeCompare(b.item.sku ?? ''));

  const spend = useMemo(() => supplierSpend(rows, selected), [rows, selected]);
  const overCat = useMemo(() => overpayByCategory(rows), [rows]);
  const totalOver = rows.reduce((t, r) => t + r.overpay, 0);
  const top = useMemo(() => [...items].sort((a, b) => annualSpend(b) - annualSpend(a)).filter((i) => annualSpend(i) > 0).slice(0, 20), [items]);

  async function act(label: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setError(null); setMsg(null);
    const { error } = await fn();
    if (error) setError(error.message);
    else setMsg(label);
    await Promise.all([refresh(), reload(), loadLog()]);
  }

  function bulkCheck(item: Item, c: SupplierCell) {
    const q = new URLSearchParams({
      item: item.id,
      np: String(c.list ?? 0),
      bp: String(c.bulk ?? 0),
      bq: String(c.bulkQty ?? 0),
      from: `${supplierName(c.supplierId)} · ${round.label}`,
    });
    nav(`/bulk?${q}`);
  }

  if (!quotes.length) {
    return <div className="card muted">No requests or quotes in {round.label} yet. Start with “Generate request.”</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ErrorMsg error={error} />
      {msg && <div className="ok-msg">{msg}</div>}

      <div className="stats">
        <div className="stat"><div className="label">Quotes saved</div><div className="value">{savedIds.length}/{inRound.length}</div><div className="small muted">{quotes.filter((q) => q.status !== 'saved').map((q) => supplierName(q.supplier_id)).join(', ') || 'All in'}</div></div>
        <div className="stat"><div className="label">Flagged items</div><div className={`value ${rows.some((r) => r.flagged) ? 'warn' : ''}`}>{rows.filter((r) => r.flagged).length}</div><div className="small muted">Current ≥ {settings.quote_gap_flag_pct}% above best</div></div>
        <div className="stat"><div className="label">Overpaying</div><div className="value">{money(totalOver)}/yr</div><div className="small muted">Current supplier vs best retail price</div></div>
      </div>

      <section className="card flush">
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row">
            <span className="small" style={{ fontWeight: 600 }}>Suppliers:</span>
            <div className="chips">
              {inRound.map((s) => {
                const q = quotes.find((x) => x.supplier_id === s.id)!;
                return (
                  <button key={s.id} className="chip" aria-pressed={selected.includes(s.id)} onClick={() => setSelected(selected.includes(s.id) ? selected.filter((x) => x !== s.id) : [...selected, s.id])}>
                    {s.name}{q.status !== 'saved' ? ` · ${q.status}` : ''}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="row">
            <select className="inp" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Flagged only</label>
            <label className="check"><input type="checkbox" checked={coverage} onChange={(e) => setCoverage(e.target.checked)} /> Quoted by all selected suppliers</label>
            <select className="inp" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ maxWidth: 200 }}>
              <option value="overpay">Sort: overpaying $/yr</option>
              <option value="gap">Sort: gap %</option>
              <option value="spend">Sort: annual spend</option>
              <option value="sku">Sort: SKU</option>
            </select>
            <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => download(new Blob([compareCsv(visible, inRound, (id) => supplierName(id))], { type: 'text/csv' }), `IWT_Quote_Comparison_${safeName(round.label)}.csv`)}>Export CSV</button>
          </div>
        </div>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Item</th><th className="num">Annual pcs</th><th className="num">Best retail $/pc</th><th className="num">Best bulk $/pc</th>
                <th className="num">Current $/pc</th><th className="num">Gap</th><th className="num">Overpaying $/yr</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && !lines.length && <tr><td colSpan={8} className="muted" style={{ padding: 20 }}>Loading…</td></tr>}
              {!loading && visible.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: 20 }}>No items match.</td></tr>}
              {visible.map((r) => (
                <Fragment key={r.item.id}>
                  <tr className="click" onClick={() => setOpenId(openId === r.item.id ? null : r.item.id)} style={r.flagged ? { background: '#fff7f1' } : undefined}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.item.name}</div>
                      <div className="small muted"><span className="mono">{r.item.sku ?? 'no SKU'}</span> · {r.item.category ?? '—'}{r.item.owner === 'owner' ? ' · owner-managed' : ''}</div>
                    </td>
                    <td className="num">{Math.round(r.annual) || '—'}</td>
                    <td className="num">{r.bestList ? <>{fmt$(r.bestList.price, 4)}<div className="small muted" style={{ fontFamily: 'inherit' }}>{supplierName(r.bestList.supplierId)}</div></> : '—'}</td>
                    <td className="num">{r.bestBulk ? <>{fmt$(r.bestBulk.price, 4)}{r.bestBulk.savingsPct != null && <span className="small" style={{ color: 'var(--accent-ink)' }}> −{r.bestBulk.savingsPct.toFixed(1)}%</span>}<div className="small muted" style={{ fontFamily: 'inherit' }}>{supplierName(r.bestBulk.supplierId)} · {r.bestBulk.qty} pcs</div></> : '—'}</td>
                    <td className="num">{r.currentPrice != null ? <>{fmt$(r.currentPrice, 4)}<div className="small muted" style={{ fontFamily: 'inherit' }}>{r.currentSupplierId ? supplierName(r.currentSupplierId) : 'No supplier set'}{r.currentSource === 'item' ? ' · on file' : ''}</div></> : '—'}</td>
                    <td className="num">{r.gapPct == null ? '—' : <span className={r.flagged ? 'pill warn' : ''}>{r.gapPct >= 0 ? '+' : ''}{r.gapPct.toFixed(1)}%</span>}</td>
                    <td className="num" style={{ fontWeight: r.overpay > 0 ? 600 : undefined }}>{r.overpay > 0 ? money(r.overpay) : '—'}</td>
                    <td><button className="btn sm" aria-expanded={openId === r.item.id} onClick={(e) => { e.stopPropagation(); setOpenId(openId === r.item.id ? null : r.item.id); }}>{openId === r.item.id ? 'Hide' : 'Suppliers'}</button></td>
                  </tr>
                  {openId === r.item.id && (
                    <tr>
                      <td colSpan={8} style={{ background: '#f8f9f7', padding: 12 }}>
                        <SupplierDetail row={r} onSetCurrent={(c) => c.line && act(`${r.item.name}: switched to ${supplierName(c.supplierId)}.`, () => supabase.rpc('set_current_supplier', { p_line: c.line!.id }))}
                          onSaveBulk={(c) => c.line && act(`${r.item.name}: bulk price saved.`, () => supabase.rpc('save_bulk_price', { p_line: c.line!.id }))}
                          onBulkCheck={(c) => bulkCheck(r.item, c)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="split">
        <section className="main card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>Spend per supplier at retail price</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Only the <b>common items</b> column is a fair comparison: it counts the {spend.commonCount} items every selected supplier quoted. “All quoted” favors suppliers who quoted fewer or cheaper items.
          </p>
          <div className="tbl">
            <table style={{ minWidth: 0 }}>
              <thead><tr><th>Supplier</th><th className="num">Common items</th><th className="num">All quoted</th><th className="num">Items quoted</th></tr></thead>
              <tbody>
                {spend.perSupplier.length === 0 && <tr><td colSpan={4} className="muted">Select at least one supplier above.</td></tr>}
                {[...spend.perSupplier].sort((a, b) => a.common - b.common).map((s) => (
                  <Fragment key={s.supplierId}>
                    <tr>
                      <td style={{ fontWeight: 600 }}>{supplierName(s.supplierId)}</td>
                      <td className="num">{money(s.common)}</td>
                      <td className="num">{money(s.allItems)}</td>
                      <td className="num">{s.allCount}</td>
                    </tr>
                    {Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
                      <tr key={c}><td className="small muted" style={{ paddingLeft: 24 }}>{c}</td><td></td><td className="num small">{money(v)}</td><td></td></tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="side">
          <section className="card">
            <h2>Overpaying by category</h2>
            <div className="kv" style={{ marginTop: 10 }}>
              {overCat.length === 0 && <div><span className="muted" style={{ fontFamily: 'inherit' }}>Nothing flagged</span><span></span></div>}
              {overCat.map(([c, v]) => <div key={c}><span style={{ fontFamily: 'inherit', textAlign: 'left' }}>{c}</span><span>{money(v)}/yr</span></div>)}
              {overCat.length > 0 && <div><span style={{ fontFamily: 'inherit', fontWeight: 600 }}>Total</span><span style={{ fontWeight: 600 }}>{money(totalOver)}/yr</span></div>}
            </div>
          </section>
          <section className="card">
            <h2>Top items by spend</h2>
            <p className="small muted" style={{ margin: '4px 0 8px' }}>Annual pieces × current cost per piece. Use for the July round.</p>
            <div className="kv">
              {top.length === 0 && <div><span className="muted" style={{ fontFamily: 'inherit' }}>Add usage and costs to rank items</span><span></span></div>}
              {top.map((i, n) => <div key={i.id}><span style={{ fontFamily: 'inherit', textAlign: 'left' }}>{n + 1}. {i.name}</span><span>{money(annualSpend(i))}</span></div>)}
            </div>
          </section>
          <section className="card">
            <h2>Recent price changes</h2>
            <div className="kv" style={{ marginTop: 10 }}>
              {log.length === 0 && <div><span className="muted" style={{ fontFamily: 'inherit' }}>None yet</span><span></span></div>}
              {log.map((l) => (
                <div key={l.id}>
                  <span style={{ fontFamily: 'inherit', textAlign: 'left' }}>
                    {itemById(l.item_id)?.name ?? 'Item'} · {l.field === 'unit_cost' ? 'cost' : l.field === 'supplier_id' ? 'supplier' : 'bulk price'}
                    <br /><span className="small muted">{when(l.changed_at)}{l.source_quote_line_id ? ' · from quote' : ''}</span>
                  </span>
                  <span className="small">{l.old_value ?? '—'} → {l.new_value ?? 'removed'}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function SupplierDetail({ row, onSetCurrent, onSaveBulk, onBulkCheck }: {
  row: CompareRow; onSetCurrent: (c: SupplierCell) => void; onSaveBulk: (c: SupplierCell) => void; onBulkCheck: (c: SupplierCell) => void;
}) {
  const { supplierName } = useData();
  const cells = Object.values(row.cells);
  return (
    <table style={{ width: '100%', minWidth: 0 }}>
      <thead><tr><th>Supplier</th><th className="num">Retail each</th><th className="num">Bulk each</th><th className="num">Bulk qty (pcs)</th><th className="num">Bulk savings</th><th className="num">Box qty</th><th>Notes</th><th></th></tr></thead>
      <tbody>
        {cells.map((c) => (
          <tr key={c.supplierId}>
            <td style={{ fontWeight: 600 }}>
              {supplierName(c.supplierId)}
              {row.currentSupplierId === c.supplierId && <span className="pill ok" style={{ marginLeft: 8 }}>Current</span>}
            </td>
            {c.state === 'quoted' ? (
              <>
                <td className="num">{fmt$(c.list, 4)}</td>
                <td className="num">{fmt$(c.bulk, 4)}</td>
                <td className="num">{c.bulkQty ?? '—'}</td>
                <td className="num">{c.list && c.bulk != null ? `${((1 - c.bulk / c.list) * 100).toFixed(1)}%` : '—'}</td>
                <td className="num">{c.line?.pieces_per_pack ?? '—'}</td>
                <td className="small">{c.line?.notes ?? ''}</td>
                <td>
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button className="btn sm" disabled={c.list == null} onClick={() => confirm(`Set ${supplierName(c.supplierId)} as current supplier for ${row.item.name} at ${fmt$(c.list, 4)}/pc?`) && onSetCurrent(c)}>Set as current supplier</button>
                    <button className="btn sm" disabled={c.bulk == null || c.bulkQty == null} onClick={() => onSaveBulk(c)}>Save bulk price</button>
                    <button className="btn sm" disabled={c.bulk == null || c.bulkQty == null || c.list == null} onClick={() => onBulkCheck(c)}>Run bulk check</button>
                  </div>
                </td>
              </>
            ) : (
              <td colSpan={7} className="small muted">{c.state === 'asked' ? 'Asked, not quoted' : 'Not asked'}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
