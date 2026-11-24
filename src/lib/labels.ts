// Code 128 bin labels drawn as vector bars (crisp at any printer resolution).
// Formats: Avery 5160 (30 per letter sheet, 1" x 2-5/8") and 2" x 1" thermal (one label per page).
import { CODE128 } from 'jsbarcode/bin/barcodes/CODE128';

export function code128Bits(text: string): string {
  const b = new CODE128(text, {});
  if (!b.valid()) throw new Error(`Can't encode "${text}" as Code 128`);
  return b.encode().data;
}

export interface LabelSpec {
  sku: string;
  name: string;
  size: string;
}

export type LabelFormat = 'avery5160' | 'thermal2x1';

type Doc = import('jspdf').jsPDF;

const IN = 72; // pt per inch

/** Draws one label with its top-left at (x, y), size w × h (points). */
function drawLabel(doc: Doc, l: LabelSpec, x: number, y: number, w: number, h: number, compact = false) {
  const pad = (compact ? 0.05 : 0.08) * IN;
  const quiet = (compact ? 0.08 : 0.1) * IN; // quiet zone each side of the bars
  // Top row: short name (left) and size (right, large)
  doc.setFont('helvetica', 'bold');
  const sizeFs = Math.min(16, h * 0.22);
  doc.setFontSize(sizeFs);
  const sizeW = l.size ? doc.getTextWidth(l.size) : 0;
  if (l.size) doc.text(l.size, x + w - pad - sizeW, y + pad + sizeFs * 0.8);
  doc.setFont('helvetica', 'normal');
  const nameFs = Math.min(8, h * 0.12);
  doc.setFontSize(nameFs);
  const maxNameW = w - 2 * pad - sizeW - 4;
  let name = l.name;
  while (name.length > 3 && doc.getTextWidth(name) > maxNameW) name = name.slice(0, -2);
  if (name !== l.name) name = name.replace(/\s+\S*$/, '') + '…';
  doc.text(name, x + pad, y + pad + nameFs * 0.85);

  // Bars
  const bits = code128Bits(l.sku);
  const barTop = y + pad + sizeFs + 2;
  const skuFs = Math.min(8, h * 0.12);
  const barH = h - (barTop - y) - pad - skuFs - 2;
  const avail = w - 2 * (pad + quiet);
  const m = avail / bits.length;
  const startX = x + pad + quiet + (avail - m * bits.length) / 2;
  doc.setFillColor(0, 0, 0);
  let run = 0;
  for (let i = 0; i <= bits.length; i++) {
    if (i < bits.length && bits[i] === '1') { run++; continue; }
    if (run) doc.rect(startX + (i - run) * m, barTop, run * m, barH, 'F');
    run = 0;
  }
  // SKU text under the bars
  doc.setFont('courier', 'bold');
  doc.setFontSize(skuFs);
  const tw = doc.getTextWidth(l.sku);
  doc.text(l.sku, x + (w - tw) / 2, y + h - pad);
}

/** skip = blank positions to leave at the start of the first Avery sheet (for partly used sheets). */
export async function buildLabelPdf(labels: LabelSpec[], format: LabelFormat, skip = 0): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  if (format === 'thermal2x1') {
    const doc = new jsPDF({ unit: 'pt', format: [2 * IN, 1 * IN], orientation: 'landscape' });
    labels.forEach((l, i) => {
      if (i > 0) doc.addPage([2 * IN, 1 * IN], 'landscape');
      drawLabel(doc, l, 0, 0, 2 * IN, 1 * IN, true);
    });
    doc.viewerPreferences({ PrintScaling: 'None', PickTrayByPDFSize: true });
    return doc.output('blob');
  }
  // Avery 5160: letter, 3 columns x 10 rows, label 2.625" x 1", top margin 0.5", left 0.1875", column pitch 2.75"
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  labels.forEach((l, n) => {
    const i = n + Math.max(0, Math.min(29, skip));
    const slot = i % 30;
    if (n > 0 && slot === 0) doc.addPage('letter', 'portrait');
    const col = slot % 3;
    const row = Math.floor(slot / 3);
    drawLabel(doc, l, (0.1875 + col * 2.75) * IN, (0.5 + row * 1) * IN, 2.625 * IN, 1 * IN);
  });
  doc.viewerPreferences({ PrintScaling: 'None' });
  return doc.output('blob');
}

/** Longest SKU that still prints at ≥2 printer dots per bar on a 203 dpi 2" thermal label (15 decoded, 17+ failed in testing). */
export const THERMAL_203_MAX_SKU = 15;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** One 2" × 1" label as HTML (barcode as SVG bars). */
function thermalLabelHtml(l: LabelSpec): string {
  const bits = code128Bits(l.sku);
  let rects = '';
  let run = 0;
  for (let i = 0; i <= bits.length; i++) {
    if (i < bits.length && bits[i] === '1') { run++; continue; }
    if (run) rects += `<rect x="${i - run}" y="0" width="${run}" height="1"/>`;
    run = 0;
  }
  return `<div class="lbl"><div class="top"><span class="name">${esc(l.name)}</span>${l.size ? `<span class="size">${esc(l.size)}</span>` : ''}</div>`
    + `<svg class="bars" viewBox="0 0 ${bits.length} 1" preserveAspectRatio="none" shape-rendering="crispEdges">${rects}</svg>`
    + `<div class="sku">${esc(l.sku)}</div></div>`;
}

/**
 * Prints 2" × 1" labels straight from the browser. The page declares its paper as 2in × 1in (@page),
 * so the print dialog uses label-sized pages instead of the default Letter sheet.
 */
export function thermalLabelsDocument(labels: LabelSpec[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>IWT labels</title><style>
    @page { size: 2in 1in; margin: 0; }
    html, body { margin: 0; padding: 0; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .lbl { width: 2in; height: 1in; box-sizing: border-box; padding: 0.05in 0.13in; display: flex; flex-direction: column; overflow: hidden; break-after: page; page-break-after: always; font-family: Helvetica, Arial, sans-serif; color: #000; }
    .lbl:last-child { break-after: auto; page-break-after: auto; }
    .top { display: flex; justify-content: space-between; align-items: baseline; gap: 4px; height: 0.2in; }
    .name { font-size: 7pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .size { font-size: 13pt; font-weight: 700; white-space: nowrap; }
    .bars { display: block; width: 100%; flex: 1; min-height: 0; fill: #000; }
    .sku { font: 700 7pt 'Courier New', Courier, monospace; text-align: center; height: 0.13in; line-height: 0.13in; }
  </style></head><body>${labels.map(thermalLabelHtml).join('')}</body></html>`;
}

export function printThermalLabels(labels: LabelSpec[]): Promise<void> {
  const html = thermalLabelsDocument(labels);
  return new Promise((resolve) => {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f);
    const done = () => { setTimeout(() => f.remove(), 1000); resolve(); };
    f.onload = () => {
      const w = f.contentWindow;
      if (!w) return done();
      w.addEventListener('afterprint', done);
      w.focus();
      w.print();
      setTimeout(done, 60_000); // fallback if afterprint never fires
    };
    f.srcdoc = html;
  });
}
