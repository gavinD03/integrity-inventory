import { useEffect, useState } from 'react';
import { useData } from '../lib/data';
import { must, supabase } from '../lib/supabase';
import { composeSku, emptyParts, normalizeSku, parseSku, SEGMENT_LABEL, SEGMENTS, validSku, type SkuParts } from '../lib/sku';
import type { SkuSegment } from '../lib/types';
import { ErrorMsg, Sheet } from './ui';

/** Category / Material / Item type / Size dropdowns that compose the SKU live. Editable until the SKU is locked. */
export default function SkuBuilder({ sku, locked, onChange }: { sku: string | null; locked: boolean; onChange: (sku: string | null) => void }) {
  const { skuCodes, isManager } = useData();
  const [parts, setParts] = useState<SkuParts>(() => (sku ? parseSku(sku, skuCodes).parts : emptyParts()));
  const [manual, setManual] = useState(false);
  const [adding, setAdding] = useState<SkuSegment | null>(null);

  useEffect(() => {
    if (sku && composeSku(parts) !== sku && !manual) setParts(parseSku(sku, skuCodes).parts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku]);

  const setPart = (k: keyof SkuParts, v: string) => {
    const next = { ...parts, [k]: v };
    if (k === 'size' && !v) next.size2 = '';
    setParts(next);
    setManual(false);
    onChange(composeSku(next) || null);
  };

  const options = (seg: SkuSegment, current: string) => {
    const list = skuCodes.filter((c) => c.segment === seg && (c.active || c.code === current));
    if (current && !list.some((c) => c.code === current)) list.push({ id: current, segment: seg, code: current, label: '(not in code list)', active: true });
    return list.sort((a, b) => a.code.localeCompare(b.code));
  };

  if (locked) {
    return (
      <div className="field">
        <label htmlFor="i-sku">SKU · locked</label>
        <input id="i-sku" className="mono" value={sku ?? ''} readOnly aria-readonly="true" style={{ background: '#f4f5f2' }} />
        <div className="hint">Locked because this item has ticket history or a printed label; changing it would break every printed barcode. To rename, archive this item and create a new one.</div>
      </div>
    );
  }

  const Select = ({ seg, k }: { seg: SkuSegment; k: keyof SkuParts }) => (
    <div className="field">
      <label htmlFor={`sku-${k}`}>{k === 'size2' ? '× Size (reducers)' : SEGMENT_LABEL[seg]}</label>
      <select id={`sku-${k}`} value={parts[k]} disabled={k === 'size2' && !parts.size}
        onChange={(e) => (e.target.value === '__add' ? setAdding(seg) : setPart(k, e.target.value))}>
        <option value="">— none —</option>
        {options(seg, parts[k]).map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}
        {isManager && <option value="__add">+ Add new code…</option>}
      </select>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        {SEGMENTS.map((seg) => <Select key={seg} seg={seg} k={seg} />)}
        <Select seg="size" k="size2" />
      </div>
      <div className="field">
        <label htmlFor="i-sku">SKU {manual ? '(edited by hand)' : '(from the dropdowns)'}</label>
        <input id="i-sku" className="mono" value={sku ?? ''} placeholder="Pick codes above or type a SKU"
          onChange={(e) => { setManual(true); onChange(e.target.value ? normalizeSku(e.target.value) : null); }} />
        {sku && !validSku(sku) && <div className="hint" style={{ color: 'var(--warn)' }}>Use letters, numbers and single dashes only.</div>}
        <div className="hint">Becomes the barcode on bin labels. It locks after the first ticket or printed label.</div>
      </div>
      {adding && <AddCode segment={adding} onClose={() => setAdding(null)} onAdded={(code) => { const k = adding as keyof SkuParts; setAdding(null); setPart(k, code); }} />}
    </div>
  );
}

export function AddCode({ segment, onClose, onAdded }: { segment: SkuSegment; onClose: () => void; onAdded: (code: string) => void }) {
  const { refresh } = useData();
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!c || !label.trim()) { setError('Enter a code and what it means'); return; }
    setBusy(true); setError(null);
    try {
      must(await supabase.from('sku_codes').insert({ segment, code: c, label: label.trim() }).select('id'));
      await refresh();
      onAdded(c);
    } catch (e) {
      const m = (e as Error).message;
      setError(/duplicate|unique/i.test(m) ? `${c} already exists as a ${SEGMENT_LABEL[segment].toLowerCase()} code.` : m);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={`New ${SEGMENT_LABEL[segment].toLowerCase()} code`} onClose={onClose}
      foot={<><ErrorMsg error={error} /><button className="btn primary block" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add code'}</button></>}>
      <div className="grid2" style={{ padding: '8px 0' }}>
        <div className="field"><label htmlFor="nc-code">Code</label><input id="nc-code" className="mono" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={segment === 'size' ? 'e.g. 150' : 'e.g. HBB'} /></div>
        <div className="field"><label htmlFor="nc-label">Means</label><input id="nc-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={segment === 'size' ? 'e.g. 1-1/2"' : 'e.g. Hose bibb'} /></div>
      </div>
    </Sheet>
  );
}
