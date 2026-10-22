import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData, type ScanResult } from '../lib/data';
import { must, supabase } from '../lib/supabase';
import type { Item } from '../lib/types';
import { ErrorMsg } from './ui';

type Found = Extract<ScanResult, { kind: 'item' }>;

/**
 * Camera barcode scanner with continuous mode. Uses the browser BarcodeDetector where it exists
 * (Android Chrome) and falls back to ZXing (iOS Safari, Firefox). A text box also accepts typed
 * codes and USB/Bluetooth scanners, which type the code and press Enter.
 *
 * onItem is called for every recognized scan and returns the message to show (e.g. "+50 → 100").
 */
export default function Scanner({ title, onItem, onCapture, onClose, allowInactive = false }: {
  title: string;
  onItem?: (r: Found) => string | Promise<string>;
  /** Capture mode: return the first raw code and skip item lookup (used when linking a barcode). */
  onCapture?: (code: string) => void;
  onClose: () => void;
  allowInactive?: boolean;
}) {
  const { resolveScan, isManager, items, refresh } = useData();
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const busyRef = useRef(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [log, setLog] = useState<{ text: string; tone: 'ok' | 'warn' }[]>([]);
  const [unknown, setUnknown] = useState<string | null>(null);

  const push = (text: string, tone: 'ok' | 'warn' = 'ok') => setLog((l) => [{ text, tone }, ...l].slice(0, 4));

  async function handle(raw: string) {
    const code = raw.trim();
    if (!code || busyRef.current) return;
    const now = Date.now();
    if (code === lastRef.current.code && now - lastRef.current.at < 1500) return; // camera sees the same label repeatedly
    lastRef.current = { code, at: now };
    if (onCapture) { navigator.vibrate?.(40); onCapture(code); return; }
    busyRef.current = true;
    try {
      const r = await resolveScan(code);
      if (r.kind === 'item') {
        navigator.vibrate?.(40);
        push(onItem ? await onItem(r) : r.item.name);
        setUnknown(null);
      } else if (r.kind === 'inactive' && !allowInactive) {
        push(`This item is inactive: ${r.name}`, 'warn');
      } else {
        navigator.vibrate?.([30, 40, 30]);
        if (isManager) setUnknown(code);
        else push(`Barcode ${code} not recognized. Search for the item instead.`, 'warn');
      }
    } finally {
      busyRef.current = false;
    }
  }
  const handleRef = useRef(handle);
  handleRef.current = handle;

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let zxingControls: { stop: () => void } | null = null;
    let timer = 0;
    const video = videoRef.current!;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setCamError('Camera not available in this browser. Type the code below.'); return; }
      const Detector = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> }; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
      let native = false;
      if (Detector?.getSupportedFormats) {
        try { native = (await Detector.getSupportedFormats()).includes('code_128'); } catch { native = false; }
      }
      try {
        if (native && Detector) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
          if (stopped) return;
          video.srcObject = stream;
          await video.play();
          const det = new Detector({ formats: ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e'] });
          const tick = async () => {
            if (stopped) return;
            try {
              if (video.readyState >= 2) {
                const found = await det.detect(video);
                if (found[0]) await handleRef.current(found[0].rawValue);
              }
            } catch { /* frame not ready */ }
            timer = window.setTimeout(tick, 120);
          };
          tick();
        } else {
          const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]);
          const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
          zxingControls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video, (result) => {
            if (result && !stopped) handleRef.current(result.getText());
          });
          if (stopped) zxingControls.stop();
        }
      } catch (e) {
        const name = (e as { name?: string }).name;
        setCamError(name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access for this site, or type the code below.' : 'Couldn’t start the camera. Type the code below.');
      }
    }
    start();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      zxingControls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet" style={{ maxWidth: 560 }}>
        <div className="sheet-head">
          <div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{title}</div>
            <div className="small muted">Scan bin labels or manufacturer barcodes. Keeps scanning until you tap Done.</div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close scanner" onClick={onClose}>×</button>
        </div>
        <div className="sheet-body" style={{ gap: 10 }}>
          <div style={{ position: 'relative', background: '#000', borderRadius: 10, overflow: 'hidden', aspectRatio: '4 / 3' }}>
            <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div aria-hidden="true" style={{ position: 'absolute', left: '10%', right: '10%', top: '42%', height: '16%', border: '2px solid rgba(159,212,207,0.9)', borderRadius: 8 }} />
          </div>
          {camError && <div className="err">{camError}</div>}
          <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); lastRef.current = { code: '', at: 0 }; handle(typed); setTyped(''); }}>
            <input className="inp mono" aria-label="Type a barcode or SKU" placeholder="Type SKU / barcode, or use a USB scanner" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" />
            <button className="btn" disabled={!typed.trim()}>Add</button>
          </form>
          {unknown && <UnknownCode code={unknown} items={items} onLinked={async () => { await refresh(); const c = unknown; setUnknown(null); lastRef.current = { code: '', at: 0 }; setTimeout(() => handleRef.current(c), 50); }} onNew={() => nav(`/items/new?barcode=${encodeURIComponent(unknown)}`)} onDismiss={() => setUnknown(null)} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} aria-live="polite">
            {log.map((l, i) => <div key={i} className={l.tone === 'ok' ? 'ok-msg' : 'err'} style={{ opacity: i === 0 ? 1 : 0.6 }}>{l.text}</div>)}
          </div>
        </div>
        <div className="sheet-foot"><button className="btn dark block" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

function UnknownCode({ code, items, onLinked, onNew, onDismiss }: {
  code: string; items: Item[]; onLinked: () => void; onNew: () => void; onDismiss: () => void;
}) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Item | null>(null);
  const [pieces, setPieces] = useState<number>(1);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const matches = q.trim() ? items.filter((i) => `${i.sku ?? ''} ${i.name}`.toLowerCase().includes(q.toLowerCase())).slice(0, 6) : [];

  async function link() {
    if (!pick) return;
    setBusy(true); setError(null);
    try {
      must(await supabase.rpc('link_barcode', { p_item: pick.id, p_code: code, p_pieces: pieces, p_label: label }));
      onLinked();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ borderColor: '#e8c98a', background: 'var(--amber-soft)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontWeight: 600 }}>Unknown barcode <span className="mono">{code}</span></div>
      {!pick ? (
        <>
          <input className="inp" placeholder="Link to existing item: search SKU or name" aria-label="Search items to link" value={q} onChange={(e) => setQ(e.target.value)} />
          {matches.map((i) => (
            <button key={i.id} type="button" className="btn sm" style={{ justifyContent: 'flex-start' }} onClick={() => { setPick(i); setPieces(i.mode === 'box' && i.units_per_box ? i.units_per_box : 1); }}>
              <span className="mono">{i.sku ?? '—'}</span>&nbsp;· {i.name}
            </button>
          ))}
          <div className="row">
            <button type="button" className="btn sm" onClick={onNew}>Add as new item</button>
            <button type="button" className="btn sm" onClick={onDismiss}>Skip</button>
          </div>
        </>
      ) : (
        <>
          <div>Link to <b>{pick.name}</b></div>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <label className="field" style={{ width: 130 }}><span className="lbl">Pieces per scan</span>
              <input className="inp mono" type="number" min={1} value={pieces} onChange={(e) => setPieces(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <label className="field" style={{ flex: 1 }}><span className="lbl">Label (optional)</span>
              <input className="inp" placeholder="e.g. Spears box of 50" value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
          </div>
          <ErrorMsg error={error} />
          <div className="row">
            <button type="button" className="btn primary sm" disabled={busy} onClick={link}>{busy ? 'Linking…' : 'Link and add'}</button>
            <button type="button" className="btn sm" onClick={() => setPick(null)}>Back</button>
          </div>
        </>
      )}
    </div>
  );
}
