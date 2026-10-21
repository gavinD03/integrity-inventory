import { useCallback, useEffect, useState } from 'react';
import { useData } from '../../lib/data';
import { must, supabase } from '../../lib/supabase';
import type { Profile, Role, Settings as S } from '../../lib/types';
import { ErrorMsg, Field, NumInput } from '../../components/ui';

export default function Settings() {
  const { me, settings, trucks, kits, items, itemById, refresh } = useData();
  const [people, setPeople] = useState<Profile[]>([]);
  const [s, setS] = useState<S>(settings);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [newTruck, setNewTruck] = useState('');
  const [newKit, setNewKit] = useState('');
  const [kitAdd, setKitAdd] = useState<Record<string, { item: string; qty: number }>>({});

  const loadPeople = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at');
    if (error) setError(error.message);
    setPeople((data as Profile[]) ?? []);
  }, []);
  useEffect(() => { loadPeople(); }, [loadPeople]);
  useEffect(() => { setS(settings); }, [settings]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null); setMsg(null);
    try { await fn(); if (ok) setMsg(ok); await refresh(); } catch (e) { setError((e as Error).message); }
  };

  async function updatePerson(p: Profile, patch: Partial<Profile>) {
    const next = { ...p, ...patch };
    await run(async () => {
      must(await supabase.rpc('update_profile', { p_user: p.id, p_role: next.role, p_truck: next.truck_id, p_name: next.full_name }));
      await loadPeople();
    }, `Updated ${next.full_name}.`);
  }

  const num = (k: keyof S) => (v: number | null) => setS({ ...s, [k]: v ?? 0 });
  const roleOptions: Role[] = me.role === 'owner' ? ['tech', 'manager', 'owner'] : ['tech', 'manager'];

  return (
    <main className="page">
      <div><h1>Settings</h1><p className="muted" style={{ margin: '6px 0 0' }}>Only the inventory manager and owner can see this page.</p></div>
      <ErrorMsg error={error} />
      {msg && <div className="ok-msg">{msg}</div>}

      <section className="card flush">
        <div style={{ padding: '14px 16px' }}>
          <h2>People + trucks</h2>
          <p className="small muted" style={{ margin: '4px 0 0' }}>New people create an account from the sign-in page, then appear here as techs. Assign each tech a truck.</p>
        </div>
        <div className="tbl">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Truck</th></tr></thead>
            <tbody>
              {people.map((p) => {
                const locked = p.role === 'owner' && me.role !== 'owner';
                return (
                  <tr key={p.id}>
                    <td>
                      <input className="inp" aria-label={`Name for ${p.email}`} defaultValue={p.full_name ?? ''} disabled={locked}
                        onBlur={(e) => e.target.value !== (p.full_name ?? '') && updatePerson(p, { full_name: e.target.value })} />
                    </td>
                    <td className="small">{p.email}</td>
                    <td>
                      <select className="inp" aria-label={`Role for ${p.full_name}`} value={p.role} disabled={locked} onChange={(e) => updatePerson(p, { role: e.target.value as Role })}>
                        {(locked ? ['owner' as Role] : roleOptions).map((r) => <option key={r} value={r}>{r === 'manager' ? 'Inventory manager' : r === 'owner' ? 'Owner' : 'Tech'}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="inp" aria-label={`Truck for ${p.full_name}`} value={p.truck_id ?? ''} disabled={locked} onChange={(e) => updatePerson(p, { truck_id: e.target.value || null })}>
                        <option value="">No truck</option>
                        {trucks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="split">
        <section className="main card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2>Calculator settings</h2>
          <div className="grid2">
            <Field label="Capital rate (%/yr)" id="s-cap" hint="Return your next use of this cash would earn"><NumInput id="s-cap" value={s.capital_rate} onChange={num('capital_rate')} /></Field>
            <Field label="Shrink / damage (%/yr)" id="s-sh" hint="Replace with the measured rate after 6–8 audits"><NumInput id="s-sh" value={s.shrink_rate} onChange={num('shrink_rate')} /></Field>
            <Field label="Tier 4 obsolescence add-on (%/yr)" id="s-t4"><NumInput id="s-t4" value={s.tier4_addon} onChange={num('tier4_addon')} /></Field>
            <Field label="Order cycle (days)" id="s-cyc" hint="7 = weekly Thursday orders"><NumInput id="s-cyc" step="1" value={s.order_cycle_days} onChange={num('order_cycle_days')} /></Field>
            <Field label="Min: days of supply floor" id="s-min"><NumInput id="s-min" step="1" value={s.min_days_supply} onChange={num('min_days_supply')} /></Field>
            <Field label="Max: days of supply" id="s-max"><NumInput id="s-max" step="1" value={s.max_days_supply} onChange={num('max_days_supply')} /></Field>
            <Field label="Cash cap without approval ($)" id="s-cash"><NumInput id="s-cash" value={s.cash_cap} onChange={num('cash_cap')} /></Field>
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
              const { capital_rate, shrink_rate, tier4_addon, order_cycle_days, min_days_supply, max_days_supply, sl_t1, sl_t2, sl_t3, sl_t4, sl_critical, cash_cap } = s;
              must(await supabase.from('app_settings').update({ capital_rate, shrink_rate, tier4_addon, order_cycle_days, min_days_supply, max_days_supply, sl_t1, sl_t2, sl_t3, sl_t4, sl_critical, cash_cap, updated_at: new Date().toISOString() }).eq('id', 1).select('id'));
            }, 'Settings saved. Min/max recalculated.')}>Save settings</button>
          </div>
        </section>

        <aside className="side">
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2>Trucks</h2>
            {trucks.map((t) => (
              <div key={t.id} className="row" style={{ flexWrap: 'nowrap' }}>
                <input className="inp" aria-label="Truck name" defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && run(async () => { must(await supabase.from('locations').update({ name: e.target.value.trim() }).eq('id', t.id).select('id')); }, 'Truck renamed.')} />
                <button className="btn sm" onClick={() => confirm(`Retire ${t.name}? Its ticket history stays.`) && run(async () => { must(await supabase.from('locations').update({ active: false }).eq('id', t.id).select('id')); }, 'Truck retired.')}>Retire</button>
              </div>
            ))}
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="inp" placeholder="New truck name" aria-label="New truck name" value={newTruck} onChange={(e) => setNewTruck(e.target.value)} />
              <button className="btn sm" disabled={!newTruck.trim()} onClick={() => run(async () => {
                must(await supabase.from('locations').insert({ name: newTruck.trim(), kind: 'truck', sort: trucks.length + 1 }).select('id'));
                setNewTruck('');
              }, 'Truck added.')}>Add</button>
            </div>
          </section>

          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2>Job kits</h2>
            <p className="small muted" style={{ margin: 0 }}>Pre-fill the parts list when a tech closes a job.</p>
            {kits.map((k) => {
              const add = kitAdd[k.id] ?? { item: '', qty: 1 };
              return (
                <div key={k.id} style={{ border: '1px solid var(--line-2)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <b>{k.name}</b>
                    <button className="btn sm" onClick={() => confirm(`Delete kit ${k.name}?`) && run(async () => { must(await supabase.from('kits').delete().eq('id', k.id).select('id')); })}>Delete</button>
                  </div>
                  {k.kit_items.map((ki) => (
                    <div key={ki.item_id} className="row small" style={{ justifyContent: 'space-between' }}>
                      <span>{itemById(ki.item_id)?.name ?? 'Archived item'} × {Number(ki.qty)}</span>
                      <button className="btn sm" onClick={() => run(async () => { must(await supabase.from('kit_items').delete().eq('kit_id', k.id).eq('item_id', ki.item_id).select('kit_id')); })}>Remove</button>
                    </div>
                  ))}
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <select className="inp" aria-label="Item to add" value={add.item} onChange={(e) => setKitAdd({ ...kitAdd, [k.id]: { ...add, item: e.target.value } })}>
                      <option value="">Add item…</option>
                      {items.filter((i) => i.mode === 'each' && !k.kit_items.some((x) => x.item_id === i.id)).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    <input className="inp" type="number" aria-label="Quantity" min={1} value={add.qty} style={{ width: 70 }} onChange={(e) => setKitAdd({ ...kitAdd, [k.id]: { ...add, qty: Number(e.target.value) } })} />
                    <button className="btn sm" disabled={!add.item || add.qty <= 0} onClick={() => run(async () => {
                      must(await supabase.from('kit_items').insert({ kit_id: k.id, item_id: add.item, qty: add.qty }).select('kit_id'));
                      setKitAdd({ ...kitAdd, [k.id]: { item: '', qty: 1 } });
                    })}>Add</button>
                  </div>
                </div>
              );
            })}
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="inp" placeholder="New kit, e.g. Softener install" aria-label="New kit name" value={newKit} onChange={(e) => setNewKit(e.target.value)} />
              <button className="btn sm" disabled={!newKit.trim()} onClick={() => run(async () => {
                must(await supabase.from('kits').insert({ name: newKit.trim() }).select('id'));
                setNewKit('');
              }, 'Kit created.')}>Create</button>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
