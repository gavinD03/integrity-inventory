import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { bulkCheck } from './calc';
import { normSku, parseItemRows, parseMinMax, parseQuoteRows, quoteWarnings, type Cell } from './quoteParse';
import { buildComparison, supplierSpend, topBySpend } from './quoteCompare';
import { buildQuotePdf, buildQuoteWorkbook, readSheet, SHEET_HEADERS } from './sheets';
import type { Item, QuoteLine, Supplier, SupplierQuote } from './types';

const item = (o: Partial<Item>): Item => ({
  id: 'i', name: 'Item', sku: null, category: 'Fittings', mode: 'each', tier: 3, critical: false, serial_tracked: false,
  strategy: 'truck', owner: 'manager', supplier_id: null, unit_cost: 0, units_per_box: null, monthly_usage: 0, usage_sd: 0,
  lead_days: 3, supplier: null, backup_supplier: null, backup_price: null, trip_cost: 0, shelf_life_months: null,
  storage_max: null, truck_par: 0, min_override: null, max_override: null, override_note: null, usage_source: 'x', active: true, ...o,
});

const line = (o: Partial<QuoteLine>): QuoteLine => ({
  id: Math.random().toString(36).slice(2), quote_id: 'q', item_id: null, requested: false, sku_raw: null, description_raw: null,
  pieces_per_pack: null, list_pack_price: null, list_unit_price: null, bulk_qty: null, bulk_unit_price: null, notes: null,
  match_status: 'matched', ...o,
});

describe('parseQuoteRows', () => {
  const head = SHEET_HEADERS;
  it('finds the header on row 4 or 6 and ignores column order and unknown columns', () => {
    for (const offset of [3, 5]) {
      const rows: Cell[][] = Array.from({ length: offset }, () => ['junk']);
      const shuffled = ['Notes', 'Bulk price per piece', 'SKU', ' list PRICE per box/pack ', 'Pieces per box/pack', 'Description', 'Bulk qty (pcs)', 'Mystery'];
      rows.push(shuffled);
      rows.push(['ok', 0.9, 'abc-1', '$50.00', 50, 'Elbow', 500, 'x']);
      const p = parseQuoteRows(rows);
      expect(p.headerRow).toBe(offset + 1);
      expect(p.rows).toHaveLength(1);
      expect(p.rows[0]).toMatchObject({ sku_raw: 'abc-1', pieces_per_pack: 50, list_pack_price: 50, bulk_qty: 500, bulk_unit_price: 0.9, notes: 'ok' });
    }
  });
  it('skips blank rows, keeps partial rows with warnings', () => {
    const rows: Cell[][] = [head, ['A', 'a', 10, '', '', '', '', '', ''], ['B', 'b', 10, 25, '12.5', null, '', '', ''], ['C', 'c', 10, 'box', 'call', null, '', '', '']];
    const p = parseQuoteRows(rows);
    expect(p.skipped).toBe(1);
    expect(p.rows.map((r) => r.sku_raw)).toEqual(['B', 'C']);
    expect(p.rows[1].issues.length).toBe(2);
  });
  it('errors when no SKU header is in the first 10 rows', () => {
    expect(parseQuoteRows([['nope']]).error).toMatch(/SKU/);
  });
});

describe('quoteWarnings', () => {
  it('flags the spec cases', () => {
    expect(quoteWarnings({ pieces_per_pack: null, list_pack_price: 10, bulk_qty: null, bulk_unit_price: null }, {})[0]).toMatch(/no pieces/);
    expect(quoteWarnings({ pieces_per_pack: 10, list_pack_price: 10, bulk_qty: 100, bulk_unit_price: 1 }, {}).join()).toMatch(/not below/);
    expect(quoteWarnings({ pieces_per_pack: 25, list_pack_price: 10, bulk_qty: null, bulk_unit_price: null }, { itemMode: 'box', itemUnitsPerBox: 50 }).join()).toMatch(/packs 25, we have 50/);
    expect(quoteWarnings({ pieces_per_pack: 1, list_pack_price: 4, bulk_qty: null, bulk_unit_price: null }, { bestOtherPerPiece: 10 }).join()).toMatch(/lower-grade/);
  });
});

describe('items master import', () => {
  it('maps the spec columns', () => {
    const rows: Cell[][] = [
      ['IWT items'],
      ['SKU', 'Description', 'Category', 'Track by (Box/Each)', 'Stock strategy', 'Owner', 'Pieces / box', 'Est. annual use (pcs)', 'Min/Max override', 'Truck par', 'Notes', 'Status'],
      ['F-1', '1" 90 PVC', 'Fittings', 'Box', 'Truck', 'Manager', 50, 1200, '', 1, '', 'Confirmed'],
      ['S-1', 'Softener 48k', 'Softeners', 'Each', 'Warehouse', 'Owner', '', 24, '2/4', 3, 'Keep 2 min', 'Confirm with dad'],
    ];
    const r = parseItemRows(rows);
    expect(r.headerRow).toBe(2);
    expect(r.rows[0].values).toMatchObject({ sku: 'F-1', mode: 'box', strategy: 'truck', units_per_box: 50, monthly_usage: 100, truck_par: 1 });
    expect(r.rows[0].confirmed).toBe(true);
    expect(r.rows[1].values).toMatchObject({ mode: 'each', strategy: 'warehouse', owner: 'owner', min_override: 2, max_override: 4, override_note: 'Keep 2 min', truck_par: 0, monthly_usage: 2 });
    expect(r.rows[1].confirmed).toBe(false);
    expect(parseMinMax('3 - 6')).toEqual({ min: 3, max: 6, ok: true });
  });
});

describe('comparison', () => {
  const sup: Supplier[] = ['A', 'B', 'C'].map((n) => ({ id: n, name: n, active: true, notes: null }));
  const quotes: SupplierQuote[] = [
    { id: 'qa', round_id: 'r', supplier_id: 'A', file_name: null, uploaded_at: '', requested_at: null, status: 'saved' },
    { id: 'qb', round_id: 'r', supplier_id: 'B', file_name: null, uploaded_at: '', requested_at: null, status: 'saved' },
    { id: 'qc', round_id: 'r', supplier_id: 'C', file_name: null, uploaded_at: '', requested_at: null, status: 'requested' },
  ];
  const items = [
    item({ id: 'e1', sku: 'E1', unit_cost: 12, monthly_usage: 10, supplier_id: 'A' }),
    item({ id: 'b1', sku: 'B1', mode: 'box', units_per_box: 50, unit_cost: 25, monthly_usage: 100 }), // $0.50/pc on file
    item({ id: 'x1', sku: 'X1', unit_cost: 5, monthly_usage: 1 }),
  ];
  const lines = [
    line({ quote_id: 'qa', item_id: 'e1', requested: true, list_unit_price: 12, list_pack_price: 12, pieces_per_pack: 1, bulk_qty: 50, bulk_unit_price: 11 }),
    line({ quote_id: 'qb', item_id: 'e1', requested: true, list_unit_price: 10, list_pack_price: 10, pieces_per_pack: 1, bulk_qty: 100, bulk_unit_price: 9 }),
    line({ quote_id: 'qc', item_id: 'e1', requested: true }),
    line({ quote_id: 'qb', item_id: 'b1', requested: true, list_unit_price: 0.4, list_pack_price: 10, pieces_per_pack: 25 }),
  ];
  const rows = buildComparison(items, sup, quotes, lines, 10);
  const r = (id: string) => rows.find((x) => x.item.id === id)!;

  it('picks best list and bulk with supplier and qty', () => {
    expect(r('e1').bestList).toMatchObject({ price: 10, supplierId: 'B' });
    expect(r('e1').bestBulk).toMatchObject({ price: 9, supplierId: 'B', qty: 100 });
  });
  it('uses the current supplier quote and computes gap and overpay = (current − best) × annual', () => {
    expect(r('e1').currentPrice).toBe(12);
    expect(r('e1').currentSource).toBe('quote');
    expect(r('e1').gapPct).toBeCloseTo(20, 5);
    expect(r('e1').overpay).toBeCloseTo((12 - 10) * 120, 5);
    expect(r('e1').flagged).toBe(true);
  });
  it('normalizes box items to per-piece cost', () => {
    expect(r('b1').currentPrice).toBeCloseTo(0.5, 6);
    expect(r('b1').overpay).toBeCloseTo((0.5 - 0.4) * 1200, 6);
  });
  it('distinguishes asked-not-quoted from not asked', () => {
    expect(r('e1').cells.C.state).toBe('asked');
    expect(r('b1').cells.A.state).toBe('not_asked');
    expect(r('x1').bestList).toBeNull();
  });
  it('common-items spend only counts items every selected supplier quoted', () => {
    const s = supplierSpend(rows, ['A', 'B']);
    expect(s.commonCount).toBe(1);
    expect(s.perSupplier.find((x) => x.supplierId === 'A')!.common).toBeCloseTo(12 * 120);
    expect(s.perSupplier.find((x) => x.supplierId === 'B')!.allItems).toBeCloseTo(10 * 120 + 0.4 * 1200);
  });
  it('top by spend uses per-piece cost × annual pieces', () => {
    expect(topBySpend(items, 2).map((i) => i.id)).toEqual(['e1', 'b1']);
  });
});

describe('carbon reference case', () => {
  it('reproduces ~$553 gross discount', () => {
    const r = bulkCheck({ normalPrice: 131, normalQty: 10, bulkPrice: 122.22, bulkQty: 63, usage: 10, holdPct: 24, tripCost: 0, freight: 0, shelfMonths: null, storageMax: null, cashCap: null });
    expect(r.savings).toBeCloseTo(553.14, 1);
    expect(r.discountPct).toBeCloseTo(6.7, 1);
  });
});

describe('generated sheet round-trip', () => {
  it('a filled-in generated sheet parses with every row matched', async () => {
    const items = Array.from({ length: 34 }, (_, n) => ({ sku: `SKU-${n + 1}`, name: `Item ${n + 1}`, annual: n * 10 }));
    const blob = await buildQuoteWorkbook({ supplier: 'Hughes', round: '2027-01 Full', date: '1/5/2027' }, items);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.worksheets[0];
    items.forEach((_, n) => {
      const row = ws.getRow(6 + n);
      row.getCell(4).value = 10;
      row.getCell(5).value = 25 + n;
      row.getCell(7).value = 100;
      row.getCell(8).value = 2;
    });
    const filled = new File([await wb.xlsx.writeBuffer()], 'reply.xlsx');
    const parsed = parseQuoteRows(await readSheet(filled));
    expect(parsed.headerRow).toBe(5);
    expect(parsed.rows).toHaveLength(34);
    const skus = new Set(items.map((i) => normSku(i.sku)));
    expect(parsed.rows.every((r) => skus.has(normSku(r.sku_raw)))).toBe(true);
    expect(parsed.rows[3]).toMatchObject({ pieces_per_pack: 10, list_pack_price: 28, bulk_qty: 100, bulk_unit_price: 2 });
  });

  it('builds a multi-page PDF', async () => {
    const items = Array.from({ length: 60 }, (_, n) => ({ sku: `SKU-${n + 1}`, name: `Sample item number ${n + 1} with a longer description`, annual: n * 12 }));
    const pdf = await buildQuotePdf({ supplier: 'Coast Pump', round: '2027-01 Full', date: '1/5/2027' }, items);
    const buf = Buffer.from(await pdf.arrayBuffer());
    const dir = process.env.PDF_OUT;
    if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/request.pdf`, buf); }
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
