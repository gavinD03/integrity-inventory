// Spreadsheet + PDF I/O for the Quotes tab. Libraries are loaded on demand to keep the main bundle small.
import type { Cell } from './quoteParse';
import { parseCsvLine } from './format';

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_');

/** Reads the first worksheet of an .xlsx (or a .csv) into a 2-D array of plain values. */
export async function readSheet(file: File, preferSheet?: RegExp): Promise<Cell[][]> {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    const text = await file.text();
    return text.split(/\r?\n/).map((l) => parseCsvLine(l));
  }
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = (preferSheet && wb.worksheets.find((w) => preferSheet.test(w.name))) || wb.worksheets[0];
  if (!ws) return [];
  const out: Cell[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const vals: Cell[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      vals[col - 1] = plain(cell.value);
    });
    out[rowNumber - 1] = vals;
  });
  for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = [];
  return out;
}

function plain(v: unknown): Cell {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return plain(o.result); // formula
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in o) return String(o.text); // hyperlink
    if ('error' in o) return null;
  }
  return String(v);
}

export interface RequestItem {
  sku: string;
  name: string;
  annual: number | null;
}

export interface RequestMeta {
  supplier: string;
  round: string;
  date: string;
}

export const SHEET_HEADERS = [
  'SKU', 'Description', 'Est. annual qty (pcs)', 'Pieces per box/pack', 'List price per box/pack',
  'List price per piece', 'Bulk qty (pcs)', 'Bulk price per piece', 'Notes',
];

export const INSTRUCTIONS =
  'Please fill in the shaded columns for each item you carry and return this file. Leave a row blank if you don’t carry the item. ' +
  'Pieces per box/pack = how you sell it; List price = price for that box/pack; Bulk qty = pieces needed for the bulk price; Bulk price = per piece.';

/** Excel reply sheet. Layout must stay in sync with parseQuoteRows (header row is found by scanning for "SKU"). */
export async function buildQuoteWorkbook(meta: RequestMeta, items: RequestItem[]): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Integrity Water Treatment';
  const ws = wb.addWorksheet('Quote Request', { views: [{ state: 'frozen', ySplit: 5 }] });
  ws.getCell('A1').value = 'Integrity Water Treatment — Quote Request';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = INSTRUCTIONS;
  ws.mergeCells('A2:I2');
  ws.getCell('A2').alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(2).height = 46;
  ws.getCell('A3').value = 'Supplier:';
  ws.getCell('B3').value = meta.supplier;
  ws.getCell('D3').value = 'Date:';
  ws.getCell('E3').value = meta.date;
  ws.getCell('G3').value = 'Round:';
  ws.getCell('H3').value = meta.round;
  for (const a of ['A3', 'D3', 'G3']) ws.getCell(a).font = { bold: true };

  const head = ws.getRow(5);
  SHEET_HEADERS.forEach((h, i) => { head.getCell(i + 1).value = h; });
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { wrapText: true, vertical: 'middle' };
  head.height = 32;
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16201C' } }; });

  const fillable = [4, 5, 7, 8, 9];
  items.forEach((it, idx) => {
    const r = 6 + idx;
    const row = ws.getRow(r);
    row.getCell(1).value = it.sku;
    row.getCell(2).value = it.name;
    row.getCell(3).value = it.annual ?? null;
    row.getCell(6).value = { formula: `IF(AND(ISNUMBER(D${r}),D${r}>0,ISNUMBER(E${r})),E${r}/D${r},"")` };
    for (const c of fillable) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF6D8' } };
    row.getCell(5).numFmt = '$#,##0.00';
    row.getCell(6).numFmt = '$#,##0.0000';
    row.getCell(8).numFmt = '$#,##0.0000';
  });
  const widths = [16, 44, 14, 14, 16, 14, 12, 14, 30];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Printable PDF request (landscape letter). Header row repeats on every page; page numbers in the footer. */
export async function buildQuotePdf(meta: RequestMeta, items: RequestItem[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Integrity Water Treatment — Quote Request', 40, 44);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Supplier: ${meta.supplier}`, 40, 64);
  doc.text(`Date: ${meta.date}`, 300, 64);
  doc.text(`Round: ${meta.round}`, 480, 64);
  const instr = doc.splitTextToSize(
    'Please write in the pieces per box/pack, list price for that box/pack, and (if offered) the bulk quantity in pieces and bulk price per piece. ' +
    'Leave a row blank if you don’t carry the item. An Excel version of this sheet is attached — replying in Excel is fastest.',
    W - 80,
  );
  doc.text(instr, 40, 82);

  autoTable(doc, {
    startY: 82 + instr.length * 12 + 6,
    head: [['SKU', 'Description', 'Est. annual qty', 'Pieces per box/pack', 'List price per box/pack', 'Bulk qty (pcs)', 'Bulk price per piece', 'Notes']],
    body: items.map((i) => [i.sku, i.name, i.annual == null ? '' : String(i.annual), '', '', '', '', '']),
    theme: 'grid',
    showHead: 'everyPage',
    styles: { fontSize: 9, cellPadding: 5, minCellHeight: 22, valign: 'middle', lineColor: [185, 194, 189], lineWidth: 0.5 },
    headStyles: { fillColor: [22, 32, 28], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 80 }, 1: { cellWidth: 200 }, 2: { cellWidth: 58, halign: 'right' },
      3: { cellWidth: 62 }, 4: { cellWidth: 72 }, 5: { cellWidth: 58 }, 6: { cellWidth: 72 }, 7: { cellWidth: 'auto' },
    },
    margin: { left: 40, right: 40, bottom: 40 },
    didDrawPage: () => {
      const page = doc.getCurrentPageInfo().pageNumber;
      doc.setFontSize(8);
      doc.setTextColor(90);
      doc.text(`${meta.supplier} · ${meta.round}`, 40, doc.internal.pageSize.getHeight() - 20);
      doc.text(`Page ${page} of {total}`, W - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
      doc.setTextColor(0);
    },
  });
  doc.putTotalPages('{total}');
  return doc.output('blob');
}
