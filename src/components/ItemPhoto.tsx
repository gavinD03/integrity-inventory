import { useRef, useState } from 'react';
import { clearItemImage, imageUrl, setItemImage } from '../lib/images';
import { ErrorMsg } from './ui';

/** Product photo on the item screen: take one with the phone camera or pick a file. Shrunk before upload. */
export default function ItemPhoto({ itemId, path, onChange }: { itemId: string | null; path: string | null | undefined; onChange: (path: string | null) => void }) {
  const camRef = useRef<HTMLInputElement>(null);
  const rollRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = imageUrl(path);

  async function pick(file: File) {
    if (!itemId) return;
    setBusy(true); setError(null);
    try { onChange(await setItemImage(itemId, file, path ?? null)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!itemId || !confirm('Remove this photo?')) return;
    setBusy(true); setError(null);
    try { await clearItemImage(itemId, path ?? null); onChange(null); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2>Photo</h2>
      {!itemId ? (
        <div className="small muted">Save the item first, then add its photo.</div>
      ) : (
        <div className="row" style={{ gap: 16, alignItems: 'center' }}>
          {url
            ? <img className="item-photo" src={url} alt="Product photo" />
            : <div className="item-photo" style={{ display: 'grid', placeItems: 'center' }}><span className="small muted">No photo yet</span></div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* capture opens the camera directly; the second input has no capture, so phones offer the camera roll / files */}
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
            <input ref={rollRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
            <button type="button" className="btn primary" disabled={busy} onClick={() => camRef.current?.click()}>{busy ? 'Saving…' : url ? 'Retake photo' : 'Take photo'}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => rollRef.current?.click()}>Choose from camera roll</button>
            {url && <button type="button" className="btn" disabled={busy} onClick={remove}>Remove</button>}
            <div className="small muted">On a computer both buttons open a file picker. Techs see the photo when they scan or search.</div>
          </div>
        </div>
      )}
      <ErrorMsg error={error} />
    </section>
  );
}
