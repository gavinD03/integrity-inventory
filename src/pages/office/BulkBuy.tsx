import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { bulkCheck, holdingRate, type BulkInput } from '../../lib/calc';
import { money } from '../../lib/format';
import { Field, NumInput } from '../../components/ui';

export default function BulkBuy() {
  const { items, breaks, settings } = useData();
  const [params, setParams] = useSearchParams();
  const withBreaks = items.filter((i) => breaks.some((b) => b.item_id === i.id && b.min_qty > 1));
  const baseChoices = withBreaks.length ? withBreaks : items;
  const itemId = params.get('item') ?? baseChoices[0]?.id ?? '';
  const choices = baseChoices.some((i) => i.id === itemId) ? baseChoices : [...baseChoices, ...items.filter((i) => i.id === itemId)];
  const item = items.find((i) => i.id === itemId);
  const itemBreaks = useMemo(() => breaks.filter((b) => b.item_id === itemId && b.min_qty > 1), [breaks, itemId]);
  const [breakIdx, setBreakIdx] = useState(0);

  const defaults = useMemo<BulkInput | null>(() => {
    if (!item) return null;
    const b = itemBreaks[Math.min(breakIdx, itemBreaks.length - 1)];
    // Work in the item's stock unit: boxes for box items (usage is stored in pieces).
    const upb = item.mode === 'box' ? item.units_per_box || 1 : 1;
    const usage = (item.monthly_usage || 0) / upb || 1;
    const q = (k: string) => { const v = params.get(k); return v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : null; };
    const fromQuote = params.get('from') != null;
    return {
      normalPrice: (fromQuote ? q('np') : null) ?? item.unit_cost,
      normalQty: Math.max(1, Math.round(usage) || 1),
      bulkPrice: (fromQuote ? q('bp') : null) ?? (b ? b.unit_price : item.unit_cost),
      bulkQty: (fromQuote ? q('bq') : null) ?? (b ? b.min_qty : Math.max(1, Math.round(usage * 3))),
      usage,
      holdPct: holdingRate(item, settings),
      tripCost: item.trip_cost,
      freight: 0,
      shelfMonths: item.shelf_life_months,
      storageMax: item.storage_max,
      cashCap: settings.cash_cap,
    };
  }, [item, itemBreaks, breakIdx, settings, params]);

  const [inp, setInp] = useState<BulkInput | null>(defaults);
  useEffect(() => { setInp(defaults); }, [defaults]);

  if (!items.length) return <main className="page"><h1>Bulk-buy check</h1><p className="muted">Add items first.</p></main>;
  if (!inp || !item) return <main className="page"><p>Loading…</p></main>;

  const r = bulkCheck(inp);
  const set = (k: keyof BulkInput) => (v: number | null) => setInp({ ...inp, [k]: v ?? 0 });
  const sens = [inp.holdPct, 30, 40].filter((v, i, a) => a.indexOf(v) === i).map((rate) => ({ rate, res: bulkCheck({ ...inp, holdPct: rate }) }));
  const beRate = isFinite(r.breakEvenRate) ? `${Math.round(r.breakEvenRate)}%` : '—';

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Bulk-buy check</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>Does the bulk price beat the cost of holding the extra stock?{item?.mode === 'box' ? ' Quantities and prices are per box.' : ''}</p>
          {params.get('from') && <p className="small" style={{ margin: '4px 0 0', color: 'var(--accent-ink)' }}>Pre-filled from quote: {params.get('from')}</p>}
        </div>
        <div className="field" style={{ minWidth: 280 }}>
          <label htmlFor="bb-item">Item</label>
          <select id="bb-item" value={itemId} onChange={(e) => { setBreakIdx(0); setParams({ item: e.target.value }); }}>
            {choices.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
      </div>

      <div className="split">
        <section className="side card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {itemBreaks.length > 1 && (
            <div className="field">
              <div className="lbl">Price break</div>
              <div className="chips">
                {itemBreaks.map((b, idx) => (
                  <button key={b.id} className="chip" aria-pressed={idx === breakIdx} onClick={() => setBreakIdx(idx)}>{b.min_qty}+ @ {money(b.unit_price, true)}</button>
                ))}
              </div>
            </div>
          )}
          <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted)' }}>Normal order</h2>
          <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Price per unit ($)" id="b-np"><NumInput id="b-np" value={inp.normalPrice} onChange={set('normalPrice')} /></Field>
            <Field label="Usual order qty" id="b-nq"><NumInput id="b-nq" value={inp.normalQty} onChange={set('normalQty')} /></Field>
          </div>
          <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted)' }}>Bulk offer</h2>
          <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Bulk price per unit ($)" id="b-bp"><NumInput id="b-bp" value={inp.bulkPrice} onChange={set('bulkPrice')} /></Field>
            <Field label="Bulk qty" id="b-bq"><NumInput id="b-bq" value={inp.bulkQty} onChange={set('bulkQty')} /></Field>
            <Field label="Extra freight ($)" id="b-fr"><NumInput id="b-fr" value={inp.freight} onChange={set('freight')} /></Field>
            <Field label="Cost per supplier trip saved ($)" id="b-tc"><NumInput id="b-tc" value={inp.tripCost} onChange={set('tripCost')} /></Field>
          </div>
          <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted)' }}>Usage + limits</h2>
          <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Usage per month" id="b-u"><NumInput id="b-u" value={inp.usage} onChange={set('usage')} /></Field>
            <Field label="Holding rate (%/yr)" id="b-h" hint={`Settings: capital ${settings.capital_rate}% + shrink ${settings.shrink_rate}%${item.tier === 4 ? ` + Tier 4 ${settings.tier4_addon}%` : ''}`}><NumInput id="b-h" value={inp.holdPct} onChange={set('holdPct')} /></Field>
            <Field label="Shelf life (months)" id="b-sl"><NumInput id="b-sl" value={inp.shelfMonths} onChange={(v) => setInp({ ...inp, shelfMonths: v })} placeholder="None" /></Field>
            <Field label="Storage max (units)" id="b-st"><NumInput id="b-st" value={inp.storageMax} onChange={(v) => setInp({ ...inp, storageMax: v })} placeholder="None" /></Field>
            <Field label="Cash cap without approval ($)" id="b-cc"><NumInput id="b-cc" value={inp.cashCap} onChange={(v) => setInp({ ...inp, cashCap: v })} /></Field>
          </div>
        </section>

        <div className="main">
          <section className={r.verdict === 'buy' ? 'dark-card' : 'card'} style={r.verdict === 'buy' ? { background: 'var(--accent)' } : r.verdict === 'approval' ? { background: 'var(--warn-soft)', borderColor: '#f0c4a6' } : undefined}>
            <div className="small" style={{ fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Recommendation</div>
            <div style={{ fontSize: 26, fontWeight: 700 }}>
              {r.verdict === 'buy' ? `Buy bulk · net ${money(r.net)}` : r.verdict === 'approval' ? `Worth it, needs approval · net ${money(r.net)}` : "Don't buy bulk"}
            </div>
            <div>
              {r.verdict === 'no'
                ? `Order the normal quantity of ${inp.normalQty}.`
                : `Saves ${money(r.gross)} up front, costs about ${money(r.hold)} to hold over ${r.months.toFixed(1)} months. Return on the tied-up cash ≈ ${beRate}/yr.`}
            </div>
            {r.flags.length > 0 && r.verdict !== 'buy' && <ul style={{ margin: 0, paddingLeft: 18 }}>{r.flags.map((f) => <li key={f}>{f}</li>)}</ul>}
          </section>

          <div className="stats">
            <div className="stat"><div className="label">Months of supply</div><div className="value">{r.months.toFixed(1)}</div><div className="small muted">{inp.bulkQty} at {inp.usage}/mo</div></div>
            <div className="stat"><div className="label">Cash outlay</div><div className="value">{money(r.outlay)}</div><div className="small muted">{money(r.extraCash)} more than a normal order</div></div>
            <div className="stat"><div className="label">Break-even window</div><div className="value">{isFinite(r.breakEvenMonths) ? `${r.breakEvenMonths.toFixed(1)} mo` : '—'}</div><div className="small muted">{r.discountPct.toFixed(1)}% discount ÷ {(inp.holdPct / 12).toFixed(1)}%/mo</div></div>
            <div className="stat"><div className="label">Units past break-even</div><div className="value">{Math.round(r.pastBreakEven)}</div><div className="small muted">Used after the window closes</div></div>
          </div>

          <section className="card">
            <h2>The math</h2>
            <div className="kv" style={{ marginTop: 10 }}>
              <div><span style={{ fontFamily: 'inherit', textAlign: 'left' }}>Discount savings ({money(inp.normalPrice, true)} − {money(inp.bulkPrice, true)}) × {inp.bulkQty}</span><span>{money(r.savings)}</span></div>
              <div><span style={{ fontFamily: 'inherit', textAlign: 'left' }}>Supplier trips avoided ({r.ordersAvoided.toFixed(1)} × {money(inp.tripCost)})</span><span>{money(r.tripSave)}</span></div>
              <div><span style={{ fontFamily: 'inherit', textAlign: 'left' }}>Extra freight</span><span>−{money(inp.freight)}</span></div>
              <div><span style={{ fontFamily: 'inherit', textAlign: 'left' }}>Extra stock on hand, average ({r.extraUnits.toFixed(1)} × {money(inp.bulkPrice, true)})</span><span>{money(r.extraValue)}</span></div>
              <div><span style={{ fontFamily: 'inherit', textAlign: 'left' }}>Holding cost ({inp.holdPct}%/yr for {r.months.toFixed(1)} mo)</span><span>−{money(r.hold)}</span></div>
              <div><span style={{ fontFamily: 'inherit', textAlign: 'left', fontWeight: 600 }}>Net savings</span><span style={{ fontWeight: 600 }}>{money(r.net)}</span></div>
              <div><span style={{ fontFamily: 'inherit', textAlign: 'left' }}>Holding rate where bulk breaks even</span><span>{beRate}/yr</span></div>
            </div>
          </section>

          <section className="card">
            <h2>If the holding rate is higher</h2>
            <div className="tbl" style={{ marginTop: 10 }}>
              <table style={{ minWidth: 0 }}>
                <thead><tr><th>Rate</th><th className="num">Holding cost</th><th className="num">Net savings</th></tr></thead>
                <tbody>{sens.map((s) => <tr key={s.rate}><td className="mono">{s.rate}%</td><td className="num">{money(s.res.hold)}</td><td className="num">{money(s.res.net)}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
