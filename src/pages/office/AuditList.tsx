import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../../lib/data';
import { supabase } from '../../lib/supabase';
import { money } from '../../lib/format';
import type { Audit, AuditCount } from '../../lib/types';
import { ErrorMsg } from '../../components/ui';

export function auditSummary(counts: AuditCount[], cost: (itemId: string) => number) {
  let expVal = 0, absVar = 0, shrink = 0, lines = 0, off = 0;
  for (const c of counts) {
    const unit = cost(c.item_id);
    const e = Number(c.expected), k = Number(c.counted);
    expVal += Math.max(0, e) * unit;
    absVar += Math.abs(k - e) * unit;
    shrink += (e - k) * unit;
    lines++;
    if (k !== e) off++;
  }
  return { lines, off, variancePct: expVal > 0 ? (absVar / expVal) * 100 : 0, shrink };
}

export default function AuditList() {
  const { itemById } = useData();
  const nav = useNavigate();
  const [audits, setAudits] = useState<Audit[]>([]);
  const [counts, setCounts] = useState<AuditCount[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from('audits').select('*').order('started_at', { ascending: false }),
      supabase.from('audit_counts').select('*'),
    ]).then(([a, c]) => {
      if (a.error) setError(a.error.message);
      setAudits((a.data as Audit[]) ?? []);
      setCounts((c.data as AuditCount[]) ?? []);
    });
  }, []);

  const open = audits.find((a) => a.status === 'open');
  const cost = (id: string) => itemById(id)?.unit_cost ?? 0;

  async function start() {
    setError(null);
    const { data, error } = await supabase.rpc('start_audit');
    if (error) setError(error.message);
    else nav(`/audits/${data}`);
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Audits</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>Weekly count → review differences → approve adjustments → place the order.</p>
        </div>
        {open
          ? <Link className="btn primary" to={`/audits/${open.id}`}>Continue audit #{open.number}</Link>
          : <button className="btn primary" onClick={start}>Start this week's audit</button>}
      </div>
      <ErrorMsg error={error} />

      <div className="split">
        <section className="main card flush">
          <div className="tbl">
            <table>
              <thead><tr><th>Audit</th><th>Started</th><th>Status</th><th className="num">Lines counted</th><th className="num">Lines off</th><th className="num">Variance</th><th className="num">Shrink $</th></tr></thead>
              <tbody>
                {audits.length === 0 && <tr><td colSpan={7} className="muted" style={{ padding: 20 }}>No audits yet. Your first audit sets opening quantities.</td></tr>}
                {audits.map((a) => {
                  const s = auditSummary(counts.filter((c) => c.audit_id === a.id), cost);
                  return (
                    <tr key={a.id} className="click" onClick={() => nav(`/audits/${a.id}`)}>
                      <td className="mono">#{a.number}</td>
                      <td>{new Date(a.started_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                      <td>{a.status === 'open' ? <span className="pill amber">Open</span> : <span className="pill ok">Completed</span>}</td>
                      <td className="num">{s.lines}</td>
                      <td className="num">{s.off}</td>
                      <td className="num" style={{ color: s.variancePct > 15 ? 'var(--warn)' : undefined }}>{s.lines ? `${s.variancePct.toFixed(1)}%` : '—'}</td>
                      <td className="num">{s.lines ? money(s.shrink) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <aside className="side">
          <section className="note">
            <h2 style={{ fontSize: 15 }}>Weekly routine (Thursdays)</h2>
            <div>1. Techs submit their truck counts from the app (or count trucks before dispatch).</div>
            <div>2. Count the warehouse: Tier 3–4 and critical items every week; Tier 1–2 rotate every 3 weeks.</div>
            <div>3. Review differences and add reasons, then complete the audit. Adjustments post automatically.</div>
            <div>4. Place the order from the reorder list. Log deliveries with Receive delivery when they arrive.</div>
            <div><b>Exit rule:</b> 4 straight weeks under 5% variance → move to every other week.</div>
          </section>
        </aside>
      </div>
    </main>
  );
}
