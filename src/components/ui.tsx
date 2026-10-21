import { useEffect, type ReactNode } from 'react';

export function Stepper({ value, onChange, min = 0, max = Infinity, suffix = '' }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string;
}) {
  return (
    <div className="stepper">
      <button type="button" aria-label="One fewer" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>−</button>
      <label className="v" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        <input
          type="number"
          inputMode="numeric"
          aria-label="Quantity"
          value={value}
          min={min}
          onChange={(e) => {
            const n = e.target.value === '' ? min : Math.floor(Number(e.target.value));
            if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
          }}
          style={{ width: 52, minHeight: 44, textAlign: 'center', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 16 }}
        />
        {suffix && <span className="small muted">{suffix.trim()}</span>}
      </label>
      <button type="button" aria-label="One more" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</button>
    </div>
  );
}

export function Sheet({ title, sub, onClose, children, foot }: {
  title: string; sub?: string; onClose: () => void; children: ReactNode; foot?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{title}</div>
            {sub && <div className="small muted">{sub}</div>}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="sheet-body">{children}</div>
        {foot && <div className="sheet-foot">{foot}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, id }: { label: string; hint?: string; children: ReactNode; id?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function NumInput({ id, value, onChange, step = 'any', min, placeholder }: {
  id?: string; value: number | null | undefined; onChange: (v: number | null) => void; step?: string; min?: number; placeholder?: string;
}) {
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      placeholder={placeholder}
      value={value == null || Number.isNaN(value) ? '' : value}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

export function Seg<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string; desc?: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="field">
      <div className="lbl" id={`seg-${label}`}>{label}</div>
      <div className="seg" role="group" aria-labelledby={`seg-${label}`}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            <b>{o.label}</b>
            {o.desc && <span>{o.desc}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ErrorMsg({ error }: { error: string | null }) {
  return error ? <div className="err" role="alert">{error}</div> : null;
}
