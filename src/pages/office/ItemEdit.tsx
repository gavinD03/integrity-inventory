import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { holdingRate, minMax, serviceLevel, spareCheck } from '../../lib/calc';
import { must, supabase } from '../../lib/supabase';
import { money } from '../../lib/format';
import type { Item } from '../../lib/types';
import { ErrorMsg, Field, NumInput, Seg } from '../../components/ui';

const blank: Item = {
  id: '', name: '', sku: null, category: null, mode: 'each', tier: 3, critical: false, serial_tracked: false,
  strategy: 'stock', unit_cost: 0, units_per_box: null, monthly_usage: 0, usage_sd: 0, lead_days: 3,
  supplier: null, backup_supplier: null, backup_price: null, trip_cost: 0, shelf_life_months: null,
  storage_max: null, truck_par: 0, min_override: null, max_override: null, override_note: null,
  usage_source: 'supplier history', active: true,
};

interface BreakRow { id?: string; min_qty: number | null; unit_price: number | null }

export default function ItemEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const { items, breaks, settings, qty, warehouse, refresh } = useData();
  const existing = id ? items.find((i) => i.id === id) : undefined;
  const [f, setF] = useState<Item>(existing ?? blank);
  const [rows, setRows] = useState<BreakRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overriding, setOverriding] = useState(false);

  useEffect(() => {
    if (existing) {
      setF(existing);
      setOverriding(existing.min_override != null || existing.max_override != null);
      setRows(breaks.filter((b) => b.item_id === existing.id).map((b) => ({ id: b.id, min_qty: b.min_qty, unit_price: b.unit_price })));
    }
  }, [existing, breaks]);

  const set = <K extends keyof Item>(k: K, v: Item[K]) => setF((p) => ({ ...p, [k]: v }));
  const calcItem = useMemo(() => (overriding ? f : { ...f, min_override: null, max_override: null }), [f, overriding]);
  const auto = useMemo(() => minMax({ ...f, min_override: null, max_override: null }, settings), [f, settings]);
  const mm = useMemo(() => minMax(calcItem, settings), [calcItem, settings]);
  const spare = spareCheck(f, settings);
  const level = serviceLevel(f, settings);

  if (id && !existing) return <main className="page"><p>Item not found. <Link to="/">Back to inventory</Link></p></main>;

  async function save() {
    if (!f.name.trim()) { setError('Name is required'); return; }
    if (overriding && !f.override_note?.trim()) { setError('Add a note explaining the min/max override'); return; }
    setBusy(true); setError(null);
    try {
      const { id: _omit, ...payload } = { ...f, name: f.name.trim() };
      void _omit;
      if (!overriding) { payload.min_override = null; payload.max_override = null; payload.override_note = null; }
      if (payload.mode === 'each') payload.units_per_box = null;
      let itemId = f.id;
      if (itemId) {
        must(await supabase.from('items').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', itemId).select('id'));
      } else {
        const created = must(await supabase.from('items').insert(payload).select('id').single()) as { id: string };
        itemId = created.id;
      }
      // replace price breaks
      must(await supabase.from('price_breaks').delete().eq('item_id', itemId).select('id'));
      const valid = rows.filter((r) => r.min_qty && r.min_qty > 0 && r.unit_price != null && r.unit_price >= 0);
      if (valid.length) must(await supabase.from('price_breaks').insert(valid.map((r) => ({ item_id: itemId, min_qty: r.min_qty, unit_price: r.unit_price }))).select('id'));
      await refresh();
      nav('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!f.id || !confirm(`Archive ${f.name}? It disappears from lists; its ticket history stays.`)) return;
    setBusy(true);
    const { error } = await supabase.from('items').update({ active: false }).eq('id', f.id);
    setBusy(false);
    if (error) setError(error.message);
    else { await refresh(); nav('/'); }
  }

  const isBox = f.mode === 'box';

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <Link to="/" className="small">← Inventory</Link>
          <h1 style={{ marginTop: 4 }}>{f.id ? f.name || 'Edit item' : 'Add item'}</h1>
          {f.id && <p className="muted" style={{ margin: '4px 0 0' }}>Warehouse on hand: <span className="mono">{qty(f.id, warehouse?.id)}{isBox ? ' boxes' : ''}</span> · change quantities through receiving, tickets or an audit</p>}
        </div>
      </div>

      <div className="split">
        <div className="main">
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2>Item</h2>
            <div className="grid2">
              <Field label="Name" id="i-name"><input id="i-name" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
              <Field label="SKU / part #" id="i-sku"><input id="i-sku" value={f.sku ?? ''} onChange={(e) => set('sku', e.target.value || null)} /></Field>
              <Field label="Category" id="i-cat"><input id="i-cat" value={f.category ?? ''} onChange={(e) => set('category', e.target.value || null)} placeholder="Systems, Media, Fittings…" /></Field>
            </div>
            <Seg label="Track by" value={f.mode} onChange={(v) => set('mode', v)} options={[
              { value: 'each', label: 'Each', desc: 'Systems, filters, media' },
              { value: 'box', label: 'Box', desc: 'Fittings: count boxes, not pieces' },
            ]} />
            <Seg label="Stock strategy" value={f.strategy} onChange={(v) => set('strategy', v)} options={[
              { value: 'stock', label: 'Stock it', desc: 'Keep on hand with min/max' },
              { value: 'job', label: 'Buy per job', desc: 'Not stocked; bought when needed' },
            ]} />
            <Seg label="Tier" value={f.tier} onChange={(v) => set('tier', v)} options={[
              { value: 1, label: 'Tier 1', desc: 'Low cost · high velocity' },
              { value: 2, label: 'Tier 2', desc: 'Low cost · low velocity' },
              { value: 3, label: 'Tier 3', desc: 'High cost · high velocity' },
              { value: 4, label: 'Tier 4', desc: 'High cost · low velocity' },
            ]} />
            <div className="row" style={{ gap: 20 }}>
              <label className="check"><input type="checkbox" checked={f.critical} onChange={(e) => set('critical', e.target.checked)} /> Critical (a stockout stops a job)</label>
              <label className="check"><input type="checkbox" checked={f.serial_tracked} onChange={(e) => set('serial_tracked', e.target.checked)} /> Track serial numbers</label>
            </div>
          </section>

          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2>Usage + cost</h2>
            <div className="grid2">
              <Field label={isBox ? 'Cost per box ($)' : 'Unit cost ($)'} id="i-cost"><NumInput id="i-cost" value={f.unit_cost} onChange={(v) => set('unit_cost', v ?? 0)} /></Field>
              {isBox && <Field label="Units per box" id="i-upb"><NumInput id="i-upb" step="1" value={f.units_per_box} onChange={(v) => set('units_per_box', v)} /></Field>}
              <Field label="Avg usage per month (units)" id="i-use" hint={`Source: ${f.usage_source}`}><NumInput id="i-use" value={f.monthly_usage} onChange={(v) => set('monthly_usage', v ?? 0)} /></Field>
              <Field label="Monthly swing (std. dev.)" id="i-sd" hint="How much usage varies month to month"><NumInput id="i-sd" value={f.usage_sd} onChange={(v) => set('usage_sd', v ?? 0)} /></Field>
              <Field label="Truck par" id="i-par" hint="Target stock per truck"><NumInput id="i-par" value={f.truck_par} onChange={(v) => set('truck_par', v ?? 0)} /></Field>
            </div>
          </section>

          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2>Suppliers</h2>
            <div className="grid2">
              <Field label="Main supplier" id="i-sup"><input id="i-sup" value={f.supplier ?? ''} onChange={(e) => set('supplier', e.target.value || null)} /></Field>
              <Field label="Lead time (days)" id="i-lead" hint="Use the worst normal case"><NumInput id="i-lead" step="1" value={f.lead_days} onChange={(v) => set('lead_days', v ?? 0)} /></Field>
              <Field label="Local backup supplier" id="i-bsup"><input id="i-bsup" value={f.backup_supplier ?? ''} onChange={(e) => set('backup_supplier', e.target.value || null)} /></Field>
              <Field label="Backup price ($)" id="i-bp"><NumInput id="i-bp" value={f.backup_price} onChange={(v) => set('backup_price', v)} /></Field>
              <Field label="Cost of a supplier trip ($)" id="i-trip"><NumInput id="i-trip" value={f.trip_cost} onChange={(v) => set('trip_cost', v ?? 0)} /></Field>
              <Field label="Shelf life (months)" id="i-shelf"><NumInput id="i-shelf" value={f.shelf_life_months} onChange={(v) => set('shelf_life_months', v)} placeholder="None" /></Field>
              <Field label="Storage max (units)" id="i-store"><NumInput id="i-store" value={f.storage_max} onChange={(v) => set('storage_max', v)} placeholder="None" /></Field>
            </div>
            <div className="field">
              <div className="lbl">Price breaks (main supplier)</div>
              {rows.map((r, idx) => (
                <div key={idx} className="row" style={{ flexWrap: 'nowrap' }}>
                  <input className="inp" type="number" aria-label="Minimum quantity" placeholder="Qty" value={r.min_qty ?? ''} onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, min_qty: e.target.value === '' ? null : Number(e.target.value) } : x)))} />
                  <input className="inp" type="number" aria-label="Unit price" placeholder="Price per unit ($)" value={r.unit_price ?? ''} onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, unit_price: e.target.value === '' ? null : Number(e.target.value) } : x)))} />
                  <button className="btn sm" onClick={() => setRows(rows.filter((_, i) => i !== idx))} aria-label="Remove price break">Remove</button>
                </div>
              ))}
              <div><button className="btn sm" onClick={() => setRows([...rows, { min_qty: null, unit_price: null }])}>+ Add price break</button></div>
            </div>
          </section>

          <ErrorMsg error={error} />
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save item'}</button>
            <Link className="btn" to="/">Cancel</Link>
            {f.id && <button className="btn" style={{ marginLeft: 'auto' }} onClick={archive} disabled={busy}>Archive</button>}
          </div>
        </div>

        <aside className="side">
          <section className="dark-card" aria-label="Min/max calculator">
            <div>
              <div className="small" style={{ fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#9fd4cf' }}>Live min / max</div>
              <div className="small muted">{f.strategy === 'job' ? 'Buy per job' : `Tier ${f.tier}${f.critical ? ' · critical' : ''} → ${level}% service level · holding ${holdingRate(f, settings)}%/yr`}</div>
            </div>
            {mm.perJob ? (
              <div>No min/max. The reorder list skips this item.</div>
            ) : (
              <>
                <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ background: 'var(--dark-2)', borderRadius: 10, padding: 12 }}>
                    <div className="small muted">Min (reorder at)</div>
                    <div className="mono" style={{ fontSize: 32 }}>{mm.min}</div>
                  </div>
                  <div style={{ background: 'var(--dark-2)', borderRadius: 10, padding: 12 }}>
                    <div className="small muted">Max (order up to)</div>
                    <div className="mono" style={{ fontSize: 32 }}>{mm.max}</div>
                  </div>
                </div>
                <div className="small muted">{mm.unit === 'boxes' ? 'In boxes' : 'In units'}{mm.overridden ? ` · overridden (calculated ${auto.min} / ${auto.max})` : ''}</div>
                <div className="kv">
                  {auto.steps.map((s) => <div key={s.label}><span style={{ color: 'var(--on-dark-2)', fontFamily: 'inherit', textAlign: 'left' }}>{s.label}</span><span>{s.value}</span></div>)}
                </div>
                {mm.isBox && (auto.boxWarn
                  ? <div className="err">One box doesn't cover the order cycle + lead time. Min raised above 1 box.</div>
                  : <div style={{ background: 'var(--dark-2)', borderRadius: 8, padding: 10, fontSize: 14 }}>One box covers the window. Two-box rule works.</div>)}
                <label className="check" style={{ color: 'var(--on-dark)' }}>
                  <input type="checkbox" checked={overriding} onChange={(e) => {
                    setOverriding(e.target.checked);
                    if (e.target.checked) setF((p) => ({ ...p, min_override: p.min_override ?? auto.min, max_override: p.max_override ?? auto.max }));
                  }} /> Override min/max
                </label>
                {overriding && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div className="field"><label htmlFor="o-min" style={{ color: 'var(--on-dark-2)' }}>Min</label><NumInput id="o-min" value={f.min_override} onChange={(v) => set('min_override', v)} /></div>
                      <div className="field"><label htmlFor="o-max" style={{ color: 'var(--on-dark-2)' }}>Max</label><NumInput id="o-max" value={f.max_override} onChange={(v) => set('max_override', v)} /></div>
                    </div>
                    <div className="field"><label htmlFor="o-note" style={{ color: 'var(--on-dark-2)' }}>Why (required)</label><input id="o-note" value={f.override_note ?? ''} onChange={(e) => set('override_note', e.target.value)} /></div>
                  </div>
                )}
              </>
            )}
          </section>

          {!mm.perJob && !isBox && (
            <section className="card">
              <h2>Is a spare worth holding?</h2>
              <div className="kv" style={{ marginTop: 10 }}>
                <div><span style={{ fontFamily: 'inherit', textAlign: 'left' }}>Hold 1 extra unit through the {f.lead_days}-day lead time</span><span>{money(spare.holdCost, true)}</span></div>
                <div><span style={{ fontFamily: 'inherit', textAlign: 'left' }}>Run short: local premium + trip</span><span>{money(spare.shortCost, true)}</span></div>
              </div>
              <div className="ok-msg" style={{ marginTop: 10 }}>
                {spare.breakEvenPct == null ? 'Enter a backup price or trip cost to compare.' : `Worth holding a spare if there's more than a ${spare.breakEvenPct.toFixed(1)}% chance you'd need it during the lead time.`}
              </div>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
