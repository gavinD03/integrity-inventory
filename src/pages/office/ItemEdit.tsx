import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { holdingRate, minMax, piecesLabel, serviceLevel, spareCheck } from '../../lib/calc';
import { must, supabase } from '../../lib/supabase';
import { money } from '../../lib/format';
import type { Item } from '../../lib/types';
import { ErrorMsg, Field, NumInput, Seg } from '../../components/ui';
import SkuBuilder from '../../components/SkuBuilder';
import ItemBarcodes, { type QueuedBarcode } from '../../components/ItemBarcodes';
import { freeSku, validSku } from '../../lib/sku';

const blank: Item = {
  id: '', name: '', sku: null, category: null, mode: 'each', tier: 3, critical: false, serial_tracked: false,
  strategy: 'truck', owner: 'manager', supplier_id: null, unit_cost: 0, units_per_box: null, monthly_usage: 0, usage_sd: 0, lead_days: 3,
  supplier: null, backup_supplier: null, backup_price: null, trip_cost: 0, shelf_life_months: null,
  storage_max: null, truck_par: 0, min_override: null, max_override: null, override_note: null,
  usage_source: 'supplier history', active: true, sku_locked: false, label_printed_at: null, notes: null, needs_confirm: null,
};

interface BreakRow { id?: string; min_qty: number | null; unit_price: number | null }

export default function ItemEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const pendingBarcode = !id ? params.get('barcode') : null;
  const [queued, setQueued] = useState<QueuedBarcode[]>([]);
  const { items, breaks, settings, qty, warehouse, refresh, suppliers } = useData();
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
  const [quoteNote, setQuoteNote] = useState<string | null>(null);

  // Picking a supplier pulls that supplier's most recent quoted price (the database does the same on save).
  async function pickSupplier(id: string | null) {
    set('supplier_id', id);
    setQuoteNote(null);
    if (!id || !f.id) return;
    const { data } = await supabase.rpc('latest_quote_line', { p_item: f.id, p_supplier: id });
    const l = data as { id: string | null; list_unit_price: number | null; pieces_per_pack: number | null } | null;
    if (!l?.id || l.list_unit_price == null) { setQuoteNote('No saved quote from this supplier for this item. Enter the price by hand.'); return; }
    const price = Math.round(Number(l.list_unit_price) * 10000) / 10000;
    setF((p) => ({
      ...p, supplier_id: id, unit_cost: price,
      units_per_box: p.mode === 'box' && !(Number(p.units_per_box) > 1) && Number(l.pieces_per_pack) > 1 ? Number(l.pieces_per_pack) : p.units_per_box,
    }));
    setQuoteNote(`Price set to $${price} from this supplier’s latest quote.`);
  }
  const calcItem = useMemo(() => (overriding ? f : { ...f, min_override: null, max_override: null }), [f, overriding]);
  const auto = useMemo(() => minMax({ ...f, min_override: null, max_override: null }, settings), [f, settings]);
  const mm = useMemo(() => minMax(calcItem, settings), [calcItem, settings]);
  const spare = spareCheck(f, settings);
  const level = serviceLevel(f, settings);

  if (id && !existing) return <main className="page"><p>Item not found. <Link to="/">Back to inventory</Link></p></main>;

  async function save() {
    if (!f.name.trim()) { setError('Name is required'); return; }
    if (overriding && !f.override_note?.trim()) { setError('Add a note explaining the min/max override'); return; }
    if (f.sku && !validSku(f.sku)) { setError('SKU can only use letters, numbers and single dashes'); return; }
    setBusy(true); setError(null);
    try {
      const { id: _omit, sku_locked: _l, label_printed_at: _p, ...payload } = { ...f, name: f.name.trim() };
      void _omit; void _l; void _p;
      // Uniqueness (case-insensitive, including archived items). On collision offer SKU-2, SKU-3…
      const changed = payload.sku && (!existing || existing.sku !== payload.sku);
      if (changed && payload.sku) {
        const { data } = await supabase.from('items').select('id, sku').ilike('sku', `${payload.sku}%`);
        const taken = ((data as { id: string; sku: string }[]) ?? []).filter((r) => r.id !== f.id).map((r) => r.sku);
        const free = freeSku(payload.sku, taken);
        if (free !== payload.sku) {
          if (!confirm(`${payload.sku} already exists. Is this a duplicate?\n\nOK = save this item as ${free}\nCancel = go back and check`)) { setBusy(false); return; }
          payload.sku = free;
        }
      }
      if (!overriding) { payload.min_override = null; payload.max_override = null; payload.override_note = null; }
      if (payload.mode === 'each') payload.units_per_box = null;
      if (payload.strategy !== 'truck') payload.truck_par = 0;
      payload.supplier = payload.supplier_id ? suppliers.find((x) => x.id === payload.supplier_id)?.name ?? payload.supplier : payload.supplier;
      let itemId = f.id;
      if (itemId) {
        must(await supabase.from('items').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', itemId).select('id'));
      } else {
        const created = must(await supabase.from('items').insert(payload).select('id').single()) as { id: string };
        itemId = created.id;
        if (pendingBarcode) must(await supabase.rpc('link_barcode', { p_item: itemId, p_code: pendingBarcode, p_pieces: null, p_label: null }));
        for (const q of queued) must(await supabase.rpc('link_barcode', { p_item: itemId, p_code: q.code, p_pieces: q.pieces, p_label: q.label }));
      }
      // Sync price breaks by quantity so only real changes are written (each change is logged).
      const valid = rows.filter((r) => r.min_qty && r.min_qty > 0 && r.unit_price != null && r.unit_price >= 0);
      const seen = new Set<number>();
      for (const r of valid) {
        if (seen.has(r.min_qty!)) throw new Error(`Two price breaks share the quantity ${r.min_qty}`);
        seen.add(r.min_qty!);
      }
      const current = breaks.filter((b) => b.item_id === itemId);
      for (const b of current) {
        if (!seen.has(b.min_qty)) must(await supabase.from('price_breaks').delete().eq('id', b.id).select('id'));
      }
      for (const r of valid) {
        const ex = current.find((b) => b.min_qty === r.min_qty);
        if (!ex) must(await supabase.from('price_breaks').insert({ item_id: itemId, min_qty: r.min_qty, unit_price: r.unit_price }).select('id'));
        else if (ex.unit_price !== r.unit_price) must(await supabase.from('price_breaks').update({ unit_price: r.unit_price }).eq('id', ex.id).select('id'));
      }
      await refresh();
      setQueued([]);
      nav(`/items/${itemId}?saved=1`, { replace: !f.id });
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
  const pieceCost: number | null = f.unit_cost;
  const suggested = f.critical || (pieceCost != null && pieceCost < settings.truck_cost_limit) ? 'truck' : 'warehouse';

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <Link to="/" className="small">← Inventory</Link>
          <h1 style={{ marginTop: 4 }}>{f.id ? f.name || 'Edit item' : 'Add item'}</h1>
          {f.id && <p className="muted" style={{ margin: '4px 0 0' }}>Warehouse on hand: <span className="mono">{piecesLabel(f, qty(f.id, warehouse?.id))} pcs</span> · change quantities through receiving, tickets or an audit</p>}
        </div>
      </div>

      <div className="split">
        <div className="main">
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2>Item</h2>
            {params.get('saved') && <div className="ok-msg">Saved.{f.sku ? ' You can print its label below.' : ''}</div>}
            {pendingBarcode && <div className="ok-msg">Barcode <span className="mono">{pendingBarcode}</span> will be linked to this item when you save.</div>}
            {f.needs_confirm && (
              <div className="row" style={{ background: 'var(--amber-soft)', color: 'var(--amber)', borderRadius: 8, padding: '10px 12px', justifyContent: 'space-between' }}>
                <span><b>To confirm:</b> {f.needs_confirm}</span>
                <button type="button" className="btn sm" onClick={() => set('needs_confirm', null)}>Mark confirmed</button>
              </div>
            )}
            <SkuBuilder sku={f.sku} locked={!!existing?.sku_locked && !!existing?.sku} onChange={(v) => set('sku', v)} />
            <div className="grid2">
              <Field label="Name" id="i-name"><input id="i-name" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
              <Field label="Category" id="i-cat"><input id="i-cat" value={f.category ?? ''} onChange={(e) => set('category', e.target.value || null)} placeholder="Systems, Media, Fittings…" /></Field>
              <Field label="Notes" id="i-notes"><input id="i-notes" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} placeholder="e.g. Stock 6 per size" /></Field>
            </div>
            <Seg label="How we buy it" value={f.mode} onChange={(v) => set('mode', v)} options={[
              { value: 'each', label: 'Individually', desc: 'Systems, filters, media' },
              { value: 'box', label: 'By the box', desc: 'Fittings: stock in pieces, order whole boxes' },
            ]} />
            <Seg label="Stock strategy" value={f.strategy} onChange={(v) => set('strategy', v)} options={[
              { value: 'truck', label: 'Truck stock', desc: 'Warehouse + truck par' },
              { value: 'warehouse', label: 'Warehouse only', desc: 'Issued to a job; never truck-stocked' },
              { value: 'job', label: 'Buy per job', desc: 'Not stocked; bought when needed' },
            ]} />
            {f.strategy !== 'job' && f.strategy !== suggested && (
              <div className="small muted" style={{ marginTop: -8 }}>
                Suggested: {suggested === 'truck' ? 'Truck stock' : 'Warehouse only'} ({f.critical ? 'critical item' : pieceCost == null ? 'set pieces per box' : `$${pieceCost.toFixed(2)}/pc vs $${settings.truck_cost_limit} truck limit`}).
              </div>
            )}
            <Seg label="Tier" value={f.tier} onChange={(v) => set('tier', v)} options={[
              { value: 1, label: 'Tier 1', desc: 'Low cost · high velocity' },
              { value: 2, label: 'Tier 2', desc: 'Low cost · low velocity' },
              { value: 3, label: 'Tier 3', desc: 'High cost · high velocity' },
              { value: 4, label: 'Tier 4', desc: 'High cost · low velocity' },
            ]} />
            <div className="row" style={{ gap: 20 }}>
              <label className="check"><input type="checkbox" checked={f.critical} onChange={(e) => set('critical', e.target.checked)} /> Critical (a stockout stops a job)</label>
              <label className="check"><input type="checkbox" checked={f.serial_tracked} onChange={(e) => set('serial_tracked', e.target.checked)} /> Track serial numbers</label>
              <label className="check"><input type="checkbox" checked={f.owner === 'owner'} onChange={(e) => set('owner', e.target.checked ? 'owner' : 'manager')} /> Owner-managed (softener systems)</label>
            </div>
          </section>

          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2>Usage + cost</h2>
            <div className="grid2">
              <Field label="Cost per piece ($)" id="i-cost" hint="Current supplier's single-piece price"><NumInput id="i-cost" value={f.unit_cost} onChange={(v) => set('unit_cost', v ?? 0)} /></Field>
              {isBox && <Field label="Box qty (pieces per box)" id="i-upb" hint="Orders round up to whole boxes"><NumInput id="i-upb" step="1" value={f.units_per_box} onChange={(v) => set('units_per_box', v)} /></Field>}
              <Field label="Avg usage per month (pieces)" id="i-use" hint={`Source: ${f.usage_source}`}><NumInput id="i-use" value={f.monthly_usage} onChange={(v) => set('monthly_usage', v ?? 0)} /></Field>
              <Field label="Monthly swing (std. dev.)" id="i-sd" hint="How much usage varies month to month"><NumInput id="i-sd" value={f.usage_sd} onChange={(v) => set('usage_sd', v ?? 0)} /></Field>
              {f.strategy === 'truck'
                ? <Field label="Truck par" id="i-par" hint="Target stock per truck"><NumInput id="i-par" value={f.truck_par} onChange={(v) => set('truck_par', v ?? 0)} /></Field>
                : <Field label="Truck par" id="i-par" hint="Only truck-stock items have a par"><input id="i-par" value="—" disabled /></Field>}
            </div>
          </section>

          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2>Suppliers</h2>
            <div className="grid2">
              <Field label="Current supplier" id="i-sup" hint={quoteNote ?? 'Cost follows this supplier’s latest saved quote'}>
                <select id="i-sup" value={f.supplier_id ?? ''} onChange={(e) => pickSupplier(e.target.value || null)}>
                  <option value="">{f.supplier && !f.supplier_id ? `${f.supplier} (not in list)` : 'None'}</option>
                  {suppliers.filter((x) => x.active || x.id === f.supplier_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
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

          <ItemBarcodes item={f} saved={existing} formSku={f.sku} onSkuChange={(v) => set('sku', v)} queued={queued} onQueue={setQueued} />

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
                <div className="small muted">{'In pieces'}{mm.isBox && f.units_per_box ? ` · ordered in boxes of ${f.units_per_box}` : ''}{mm.overridden ? ` · overridden (calculated ${auto.min} / ${auto.max})` : ''}</div>
                <div className="kv">
                  {auto.steps.map((s) => <div key={s.label}><span style={{ color: 'var(--on-dark-2)', fontFamily: 'inherit', textAlign: 'left' }}>{s.label}</span><span>{s.value}</span></div>)}
                </div>
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

          {!mm.perJob && (
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
