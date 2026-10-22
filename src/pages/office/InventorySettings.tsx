import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { must, supabase } from '../../lib/supabase';
import type { Settings as S } from '../../lib/types';
import { ErrorMsg, Field, NumInput } from '../../components/ui';
import SkuCodesSettings from '../../components/SkuCodesSettings';
import ItemSetup from '../../components/ItemSetup';

type Tab = 'setup' | 'sku' | 'suppliers' | 'rules';

export default function InventorySettings() {
  const { settings, suppliers, refresh } = useData();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'setup';
  const [s, setS] = useState<S>(settings);
  const [newSupplier, setNewSupplier] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setS(settings); }, [settings]);
  const num = (k: keyof S) => (v: number | null) => setS({ ...s, [k]: v ?? 0 });
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null); setMsg(null);
    try { await fn(); if (ok) setMsg(ok); await refresh(); } catch (e) { setError((e as Error).message); }
  };
  const tabs: [Tab, string][] = [['setup', 'Item setup'], ['sku', 'SKU codes'], ['suppliers', 'Suppliers'], ['rules', 'Min/max + holding']];

  return (
    <main className="page">
      <div><h1>Inventory settings</h1><p className="muted" style={{ margin: '6px 0 0' }}>Item completeness, SKU codes, suppliers and the rules behind min/max and bulk buys.</p></div>
      <div className="chips" role="tablist" aria-label="Inventory settings">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" className="chip" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => { setMsg(null); setError(null); setParams(k === 'setup' ? {} : { tab: k }); }}>{l}</button>
        ))}
      </div>
      <ErrorMsg error={error} />
      {msg && <div className="ok-msg">{msg}</div>}

      {tab === 'setup' && <ItemSetup />}
      {tab === 'sku' && <div style={{ maxWidth: 720 }}><SkuCodesSettings /></div>}
      {tab === 'suppliers' && (
            <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
              <h2>Suppliers</h2>
              <p className="small muted" style={{ margin: 0 }}>Contact and email are used when you email quote requests.</p>
              {suppliers.map((x) => (
                <div key={x.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--line)', opacity: x.active ? 1 : 0.6 }}>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <input className="inp" aria-label="Supplier name" defaultValue={x.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== x.name && run(async () => { must(await supabase.from('suppliers').update({ name: e.target.value.trim() }).eq('id', x.id).select('id')); }, 'Supplier renamed.')} />
                    <button className="btn sm" onClick={() => run(async () => { must(await supabase.from('suppliers').update({ active: !x.active }).eq('id', x.id).select('id')); }, x.active ? `${x.name} deactivated.` : `${x.name} reactivated.`)}>{x.active ? 'Deactivate' : 'Reactivate'}</button>
                  </div>
                  <input className="inp" aria-label={`${x.name} contact name`} placeholder="Contact name" defaultValue={x.contact_name ?? ''} onBlur={(e) => e.target.value.trim() !== (x.contact_name ?? '') && run(async () => { must(await supabase.from('suppliers').update({ contact_name: e.target.value.trim() || null }).eq('id', x.id).select('id')); }, 'Contact saved.')} />
                  <input className="inp" type="email" aria-label={`${x.name} quote email`} placeholder="Quote email (comma-separate several)" defaultValue={x.email ?? ''} onBlur={(e) => e.target.value.trim() !== (x.email ?? '') && run(async () => { must(await supabase.from('suppliers').update({ email: e.target.value.trim() || null }).eq('id', x.id).select('id')); }, 'Email saved.')} />
                </div>
              ))}
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input className="inp" placeholder="New supplier name" aria-label="New supplier name" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} />
                <button className="btn sm" disabled={!newSupplier.trim()} onClick={() => run(async () => {
                  must(await supabase.from('suppliers').insert({ name: newSupplier.trim() }).select('id'));
                  setNewSupplier('');
                }, 'Supplier added.')}>Add</button>
              </div>
            </section>
      )}
      {tab === 'rules' && (
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820 }}>
          <h2>Min/max + holding rules</h2>
          <div className="grid2">
            <Field label="Capital rate (%/yr)" id="s-cap" hint="Return your next use of this cash would earn"><NumInput id="s-cap" value={s.capital_rate} onChange={num('capital_rate')} /></Field>
            <Field label="Shrink / damage (%/yr)" id="s-sh" hint="Replace with the measured rate after 6–8 audits"><NumInput id="s-sh" value={s.shrink_rate} onChange={num('shrink_rate')} /></Field>
            <Field label="Tier 4 obsolescence add-on (%/yr)" id="s-t4"><NumInput id="s-t4" value={s.tier4_addon} onChange={num('tier4_addon')} /></Field>
            <Field label="Order cycle (days)" id="s-cyc" hint="7 = weekly Thursday orders"><NumInput id="s-cyc" step="1" value={s.order_cycle_days} onChange={num('order_cycle_days')} /></Field>
            <Field label="Min: days of supply floor" id="s-min"><NumInput id="s-min" step="1" value={s.min_days_supply} onChange={num('min_days_supply')} /></Field>
            <Field label="Max: days of supply" id="s-max"><NumInput id="s-max" step="1" value={s.max_days_supply} onChange={num('max_days_supply')} /></Field>
            <Field label="Cash cap without approval ($)" id="s-cash"><NumInput id="s-cash" value={s.cash_cap} onChange={num('cash_cap')} /></Field>
            <Field label="Truck cost limit ($ per piece)" id="s-tcl" hint="Under this → truck stock; over → warehouse only"><NumInput id="s-tcl" value={s.truck_cost_limit} onChange={num('truck_cost_limit')} /></Field>
            <Field label="Quote gap flag (%)" id="s-gap" hint="Flag items where the current price is this much above the best quote"><NumInput id="s-gap" value={s.quote_gap_flag_pct} onChange={num('quote_gap_flag_pct')} /></Field>
          </div>
          <h2 style={{ fontSize: 15 }}>Service levels (%)</h2>
          <div className="grid2">
            <Field label="Tier 1" id="s-l1"><NumInput id="s-l1" value={s.sl_t1} onChange={num('sl_t1')} /></Field>
            <Field label="Tier 2" id="s-l2"><NumInput id="s-l2" value={s.sl_t2} onChange={num('sl_t2')} /></Field>
            <Field label="Tier 3" id="s-l3"><NumInput id="s-l3" value={s.sl_t3} onChange={num('sl_t3')} /></Field>
            <Field label="Tier 4" id="s-l4"><NumInput id="s-l4" value={s.sl_t4} onChange={num('sl_t4')} /></Field>
            <Field label="Critical items" id="s-lc"><NumInput id="s-lc" value={s.sl_critical} onChange={num('sl_critical')} /></Field>
          </div>
          <div className="small muted">Holding rate = capital + shrink (+ Tier 4 add-on) = {Number(s.capital_rate) + Number(s.shrink_rate)}%/yr. Utilities and insurance are excluded as fixed costs.</div>
          <div>
            <button className="btn primary" onClick={() => run(async () => {
              const { capital_rate, shrink_rate, tier4_addon, order_cycle_days, min_days_supply, max_days_supply, sl_t1, sl_t2, sl_t3, sl_t4, sl_critical, cash_cap, truck_cost_limit, quote_gap_flag_pct } = s;
              must(await supabase.from('app_settings').update({ capital_rate, shrink_rate, tier4_addon, order_cycle_days, min_days_supply, max_days_supply, sl_t1, sl_t2, sl_t3, sl_t4, sl_critical, cash_cap, truck_cost_limit, quote_gap_flag_pct, updated_at: new Date().toISOString() }).eq('id', 1).select('id'));
            }, 'Saved. Min/max recalculated.')}>Save</button>
          </div>
        </section>
      )}
    </main>
  );
}
