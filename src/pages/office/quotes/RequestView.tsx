import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../../lib/data';
import { must, supabase } from '../../../lib/supabase';
import { annualUse, topBySpend } from '../../../lib/quoteCompare';
import { buildQuotePdf, buildQuoteWorkbook, download, safeName, type RequestItem } from '../../../lib/sheets';
import type { QuoteRound, SupplierQuote } from '../../../lib/types';
import { ErrorMsg } from '../../../components/ui';
import { previousRequests } from './useQuotes';

type Prev = Awaited<ReturnType<typeof previousRequests>>[number];

export default function RequestView({ round, quotes, reload }: { round: QuoteRound; quotes: SupplierQuote[]; reload: () => Promise<void> }) {
  const { items, suppliers, supplierName } = useData();
  const active = suppliers.filter((s) => s.active);
  const [supplierId, setSupplierId] = useState<string>('');
  // Every item is listed by default; deselect what this supplier doesn't carry.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((i) => i.id)));
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('');
  const [strategy, setStrategy] = useState('');
  const [owner, setOwner] = useState('');
  const [topN, setTopN] = useState(20);
  const [prev, setPrev] = useState<Prev[]>([]);
  const [copyFrom, setCopyFrom] = useState('');
  const [includeAnnual, setIncludeAnnual] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ xlsx: Blob; pdf: Blob; base: string; count: number } | null>(null);

  useEffect(() => { previousRequests().then(setPrev); }, [quotes]);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean) as string[])].sort(), [items]);
  const visible = items.filter((i) =>
    (!search || `${i.sku ?? ''} ${i.name}`.toLowerCase().includes(search.toLowerCase())) &&
    (!cat || i.category === cat) && (!strategy || i.strategy === strategy) && (!owner || i.owner === owner));
  const existing = quotes.find((q) => q.supplier_id === supplierId);
  const missingSku = items.filter((i) => selected.has(i.id) && !i.sku?.trim());

  const toggle = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
    setGenerated(null);
  };
  const addAll = (ids: string[]) => { setSelected(new Set([...selected, ...ids])); setGenerated(null); };

  async function generate() {
    if (!supplierId) return;
    setBusy(true); setError(null); setGenerated(null);
    try {
      const chosen = items.filter((i) => selected.has(i.id)).sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || (a.sku ?? '').localeCompare(b.sku ?? ''));
      const res = must(await supabase.rpc('create_quote_request', { p_round: round.id, p_supplier: supplierId, p_items: chosen.map((i) => i.id) })) as { lines: number };
      const meta = { supplier: supplierName(supplierId), round: round.label, date: new Date().toLocaleDateString() };
      const rows: RequestItem[] = chosen.map((i) => ({ sku: i.sku ?? '', name: i.name, annual: includeAnnual ? Math.round(annualUse(i)) || null : null }));
      const [xlsx, pdf] = await Promise.all([buildQuoteWorkbook(meta, rows), buildQuotePdf(meta, rows)]);
      const base = `IWT_Quote_${safeName(round.label)}_${safeName(meta.supplier)}`;
      // Browsers block a second automatic download, so each file gets its own button below.
      setGenerated({ xlsx, pdf, base, count: res.lines });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const supplierPrev = prev.filter((p) => !supplierId || p.supplierId === supplierId);

  return (
    <div className="split">
      <section className="main" style={{ gap: 16 }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>1 · Supplier</h2>
          <div className="chips">
            {active.map((s) => {
              const q = quotes.find((x) => x.supplier_id === s.id);
              return (
                <button key={s.id} className="chip" aria-pressed={supplierId === s.id} onClick={() => { setSupplierId(s.id); setGenerated(null); }}>
                  {s.name}{q ? ` · ${q.status === 'saved' ? 'quoted' : q.status === 'requested' ? 'requested' : 'draft'}` : ''}
                </button>
              );
            })}
          </div>
          {existing?.status === 'saved' && <div className="err">{supplierName(supplierId)} already returned a quote for {round.label}. Upload or edit their reply instead of sending a new request.</div>}
          {existing?.status === 'requested' && <div className="small muted">A request was already generated for this supplier. Generating again replaces its item list.</div>}
        </div>

        <div className="card flush">
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2>2 · Items</h2>
            <div className="row">
              <input className="inp" type="search" placeholder="Search SKU or name" aria-label="Search items" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 240 }} />
              <select className="inp" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)} style={{ maxWidth: 200 }}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="inp" aria-label="Strategy" value={strategy} onChange={(e) => setStrategy(e.target.value)} style={{ maxWidth: 170 }}>
                <option value="">All strategies</option>
                <option value="truck">Truck stock</option>
                <option value="warehouse">Warehouse only</option>
                <option value="job">Buy per job</option>
              </select>
              <select className="inp" aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} style={{ maxWidth: 170 }}>
                <option value="">Any owner</option>
                <option value="manager">Manager-managed</option>
                <option value="owner">Owner-managed</option>
              </select>
            </div>
            <div className="row">
              <button className="btn sm" onClick={() => addAll(visible.map((i) => i.id))}>Select all shown ({visible.length})</button>
              <button className="btn sm" onClick={() => { setSelected(new Set()); setGenerated(null); }}>Clear</button>
              {cat && <button className="btn sm" onClick={() => addAll(items.filter((i) => i.category === cat).map((i) => i.id))}>Select all in {cat}</button>}
              <span className="row" style={{ gap: 6 }}>
                <input className="inp" type="number" min={1} aria-label="Top N" value={topN} onChange={(e) => setTopN(Math.max(1, Number(e.target.value) || 1))} style={{ width: 70, minHeight: 36 }} />
                <button className="btn sm" onClick={() => addAll(topBySpend(items, topN).map((i) => i.id))}>Add top {topN} by spend</button>
              </span>
              <span className="row" style={{ gap: 6 }}>
                <select className="inp" aria-label="Copy selection from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} style={{ minHeight: 36, maxWidth: 260 }}>
                  <option value="">Copy selection from…</option>
                  {supplierPrev.map((p) => <option key={p.id} value={p.id}>{p.roundLabel} · {supplierName(p.supplierId)} ({p.itemIds.length})</option>)}
                </select>
                <button className="btn sm" disabled={!copyFrom} onClick={() => {
                  const p = prev.find((x) => x.id === copyFrom);
                  if (p) { setSelected(new Set(p.itemIds.filter((id) => items.some((i) => i.id === id)))); setGenerated(null); }
                }}>Copy</button>
              </span>
            </div>
            <div style={{ fontWeight: 600 }}>{selected.size} {selected.size === 1 ? 'item' : 'items'} selected</div>
          </div>
          <div className="tbl" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table>
              <thead><tr><th style={{ width: 40 }}></th><th>SKU</th><th>Item</th><th>Category</th><th className="num">Annual pcs</th></tr></thead>
              <tbody>
                {visible.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: 20 }}>{items.length ? 'No items match.' : 'No items yet. Import your item list first.'}</td></tr>}
                {visible.map((i) => (
                  <tr key={i.id} className="click" onClick={() => toggle(i.id)}>
                    <td><input type="checkbox" aria-label={`Select ${i.name}`} checked={selected.has(i.id)} onChange={() => toggle(i.id)} onClick={(e) => e.stopPropagation()} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} /></td>
                    <td className="mono">{i.sku ?? <span className="pill warn">No SKU</span>}</td>
                    <td>{i.name}{i.owner === 'owner' && <span className="small muted"> · owner</span>}</td>
                    <td>{i.category ?? '—'}</td>
                    <td className="num">{Math.round(annualUse(i)) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <aside className="side">
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>3 · Generate</h2>
          <label className="check"><input type="checkbox" checked={includeAnnual} onChange={(e) => setIncludeAnnual(e.target.checked)} /> Include estimated annual quantities</label>
          <div className="small muted">Suppliers need volume to quote real bulk pricing.</div>
          {missingSku.length > 0 && <div className="err">{missingSku.length} selected items have no SKU, so their replies can't be matched automatically. Add SKUs first.</div>}
          <ErrorMsg error={error} />
          <button className="btn primary block" disabled={busy || !supplierId || selected.size === 0 || existing?.status === 'saved'} onClick={generate}>
            {busy ? 'Generating…' : !supplierId ? 'Pick a supplier' : `Generate for ${supplierName(supplierId)} · ${selected.size} items`}
          </button>
          <div className="note" style={{ padding: 12 }}>Send both: <b>PDF to read, Excel to reply.</b> If they write on the PDF, use “Enter by hand.”</div>
          {generated && (
            <div className="ok-msg" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span>Request recorded with {generated.count} items. Download both files:</span>
              <span className="row" style={{ gap: 8 }}>
                <button className="btn primary" onClick={() => download(generated.xlsx, `${generated.base}.xlsx`)}>Download Excel</button>
                <button className="btn" onClick={() => download(generated.pdf, `${generated.base}.pdf`)}>Download PDF</button>
              </span>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
