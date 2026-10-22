// Pure parsing + validation for supplier quote sheets and the Items master sheet.
// Works on a 2-D array of cell values so it can be unit-tested without a spreadsheet library.

export type Cell = string | number | boolean | null | undefined;

/** Lowercase, strip punctuation, collapse whitespace: "List price per box/pack " → "list price per box pack". */
export const normHeader = (v: Cell) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const cellText = (v: Cell) => (v == null ? '' : String(v).trim());

/** Parses "$1,234.50" / " 12 " / 12 → number. Blank → null. Anything else → NaN (caller warns). */
export function toNum(v: Cell): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'boolean') return NaN;
  const s = v.trim();
  if (!s) return null;
  const cleaned = s.replace(/[$,\s]/g, '');
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

/** Index of the first row (within the first `scan` rows) containing a cell equal to `target` (normalized). */
export function findHeaderRow(rows: Cell[][], target = 'sku', scan = 10): number {
  for (let r = 0; r < Math.min(scan, rows.length); r++) {
    if ((rows[r] ?? []).some((c) => normHeader(c) === target)) return r;
  }
  return -1;
}

// ── Quote sheets ────────────────────────────────────────────────────────────

export type QuoteField = 'sku' | 'description' | 'annual' | 'pieces' | 'list_pack' | 'list_piece' | 'bulk_qty' | 'bulk_price' | 'notes';

export function quoteFieldFor(header: Cell): QuoteField | null {
  const h = normHeader(header);
  if (!h) return null;
  if (h === 'sku' || h === 'part' || h === 'part number' || h === 'item sku') return 'sku';
  if (h.startsWith('description') || h === 'item' || h === 'name') return 'description';
  if (h.includes('annual')) return 'annual';
  if (h.includes('bulk') && (h.includes('qty') || h.includes('quantity'))) return 'bulk_qty';
  if (h.includes('bulk') && h.includes('price')) return 'bulk_price';
  if (h.includes('retail') || h.includes('1 off') || h.includes('one off') || h === 'each' || h === 'price each') return 'list_piece';
  if (h.includes('box qty') || h.includes('box quantity') || h.includes('pieces per') || h.includes('pcs per') || h.includes('pack size') || (h.includes('per box pack') && !h.includes('price'))) return 'pieces';
  if (h.includes('list price') && (h.includes('piece') || h.includes('pc')) && !h.includes('box') && !h.includes('pack')) return 'list_piece';
  if (h.includes('list price') || h === 'price') return 'list_pack';
  if (h.startsWith('note') || h === 'comments') return 'notes';
  return null;
}

export interface ParsedQuoteRow {
  row: number; // 1-based sheet row
  sku_raw: string;
  description_raw: string;
  pieces_per_pack: number | null;
  list_pack_price: number | null;
  list_unit_price: number | null; // retail (1-off) price per piece; computed from pack price on older sheets
  bulk_qty: number | null;
  bulk_unit_price: number | null;
  notes: string;
  issues: string[];
}

export interface ParsedQuote {
  headerRow: number; // 1-based, -1 if not found
  columns: Partial<Record<QuoteField, number>>;
  rows: ParsedQuoteRow[];
  skipped: number;
  error: string | null;
}

export function parseQuoteRows(rows: Cell[][]): ParsedQuote {
  const h = findHeaderRow(rows, 'sku');
  if (h < 0) return { headerRow: -1, columns: {}, rows: [], skipped: 0, error: 'No "SKU" header found in the first 10 rows.' };
  const columns: Partial<Record<QuoteField, number>> = {};
  (rows[h] ?? []).forEach((c, idx) => {
    const f = quoteFieldFor(c);
    if (f && columns[f] == null) columns[f] = idx;
  });
  const out: ParsedQuoteRow[] = [];
  let skipped = 0;
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const get = (f: QuoteField) => (columns[f] == null ? null : row[columns[f]!]);
    const sku = cellText(get('sku'));
    const desc = cellText(get('description'));
    const raw = {
      pieces: get('pieces'), list: get('list_pack'), retail: get('list_piece'), bq: get('bulk_qty'), bp: get('bulk_price'),
    };
    const blank = (v: Cell) => v == null || cellText(v) === '';
    if (!sku && !desc && Object.values(raw).every(blank)) continue; // empty sheet row
    if (Object.values(raw).every(blank)) { skipped++; continue; } // supplier doesn't carry it
    const issues: string[] = [];
    const num = (v: Cell, label: string) => {
      const n = toNum(v);
      if (n != null && Number.isNaN(n)) { issues.push(`${label}: "${cellText(v)}" isn't a number`); return null; }
      if (n != null && n < 0) { issues.push(`${label} is negative`); return null; }
      return n;
    };
    let pieces = num(raw.pieces, 'Pieces per pack');
    if (pieces === 0) { issues.push('Pieces per pack is 0'); pieces = null; }
    let bulkQty = num(raw.bq, 'Bulk qty');
    if (bulkQty === 0) { issues.push('Bulk qty is 0'); bulkQty = null; }
    const packPrice = num(raw.list, 'List price');
    const retail = num(raw.retail, 'Retail price');
    out.push({
      row: r + 1,
      sku_raw: sku,
      description_raw: desc,
      pieces_per_pack: pieces,
      list_pack_price: packPrice,
      list_unit_price: retail ?? (packPrice != null && pieces ? packPrice / pieces : null),
      bulk_qty: bulkQty,
      bulk_unit_price: num(raw.bp, 'Bulk price'),
      notes: cellText(get('notes')),
      issues,
    });
  }
  return { headerRow: h + 1, columns, rows: out, skipped, error: null };
}

export const normSku = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export interface QuoteCheckContext {
  itemMode?: 'each' | 'box';
  itemUnitsPerBox?: number | null;
  bestOtherPerPiece?: number | null; // best list $/pc from other suppliers (or current cost if none)
}

/** Warnings shown in the upload preview and manual entry. Never blockers. */
export function quoteWarnings(
  l: Pick<ParsedQuoteRow, 'pieces_per_pack' | 'list_unit_price' | 'bulk_qty' | 'bulk_unit_price'> & { list_pack_price?: number | null },
  ctx: QuoteCheckContext,
): string[] {
  const w: string[] = [];
  const retail = l.list_unit_price;
  if (retail == null && l.list_pack_price != null && !l.pieces_per_pack) w.push('Pack price but no box qty — per-piece price can’t be computed');
  if (retail == null && l.bulk_unit_price != null) w.push('Bulk price but no retail (1-off) price — savings % can’t be computed');
  if (retail != null && l.bulk_unit_price != null && l.bulk_unit_price >= retail) w.push('Bulk price is not below the retail price');
  if ((l.bulk_qty == null) !== (l.bulk_unit_price == null)) w.push('Bulk qty and bulk price should both be filled');
  if (ctx.itemMode === 'box' && l.pieces_per_pack && ctx.itemUnitsPerBox && l.pieces_per_pack !== ctx.itemUnitsPerBox) {
    w.push(`Their box is ${l.pieces_per_pack}, ours on file is ${ctx.itemUnitsPerBox} (switching to them changes the box size)`);
  }
  if (retail != null && ctx.bestOtherPerPiece != null && ctx.bestOtherPerPiece > 0 && retail < ctx.bestOtherPerPiece * 0.5) {
    w.push('More than 50% below the current best — possible lower-grade equivalent, confirm brand');
  }
  return w;
}

/** Bulk savings vs buying one: 1 − bulk ÷ retail, as a percent. */
export const bulkSavingsPct = (retail: number | null | undefined, bulk: number | null | undefined) =>
  retail != null && bulk != null && retail > 0 ? (1 - bulk / retail) * 100 : null;

// ── Items master sheet (IWT_Inventory_Master.xlsx → Items tab) ─────────────

export interface ParsedItemRow {
  row: number;
  confirmed: boolean;
  status: string;
  values: {
    sku: string;
    name: string;
    category: string | null;
    mode: 'each' | 'box';
    strategy: 'truck' | 'warehouse' | 'job';
    owner: 'manager' | 'owner';
    units_per_box: number | null;
    monthly_usage: number;
    min_override: number | null;
    max_override: number | null;
    override_note: string | null;
    truck_par: number;
    notes: string | null;
    needs_confirm: string | null;
  };
  issues: string[];
}

type ItemField = 'sku' | 'name' | 'category' | 'mode' | 'strategy' | 'owner' | 'upb' | 'annual' | 'minmax' | 'par' | 'notes' | 'status';

export function itemFieldFor(header: Cell): ItemField | null {
  const h = normHeader(header);
  if (!h) return null;
  if (h === 'sku') return 'sku';
  if (h.startsWith('description') || h === 'name' || h === 'item') return 'name';
  if (h.startsWith('category')) return 'category';
  if (h.startsWith('track by') || h === 'mode' || h === 'tracked') return 'mode';
  if (h.includes('strategy')) return 'strategy';
  if (h === 'owner' || h.startsWith('owner ')) return 'owner';
  if (h.includes('pieces') && h.includes('box')) return 'upb';
  if (h.includes('annual')) return 'annual';
  if (h.includes('override') || (h.includes('min') && h.includes('max'))) return 'minmax';
  if (h.includes('par')) return 'par';
  if (h.startsWith('note')) return 'notes';
  if (h.startsWith('status')) return 'status';
  return null;
}

export function parseMinMax(v: Cell): { min: number | null; max: number | null; ok: boolean } {
  const s = cellText(v);
  if (!s) return { min: null, max: null, ok: true };
  const nums = s.match(/\d+(\.\d+)?/g);
  if (!nums) return { min: null, max: null, ok: false };
  if (nums.length === 1) return { min: Number(nums[0]), max: null, ok: true };
  return { min: Number(nums[0]), max: Number(nums[1]), ok: true };
}

export function parseItemRows(rows: Cell[][]): { rows: ParsedItemRow[]; error: string | null; headerRow: number } {
  const h = findHeaderRow(rows, 'sku');
  if (h < 0) return { rows: [], error: 'No "SKU" header found in the first 10 rows.', headerRow: -1 };
  const cols: Partial<Record<ItemField, number>> = {};
  (rows[h] ?? []).forEach((c, idx) => {
    const f = itemFieldFor(c);
    if (f && cols[f] == null) cols[f] = idx;
  });
  if (cols.name == null) return { rows: [], error: 'No "Description" column found.', headerRow: h + 1 };
  const out: ParsedItemRow[] = [];
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const get = (f: ItemField) => (cols[f] == null ? null : row[cols[f]!]);
    const sku = cellText(get('sku'));
    const name = cellText(get('name'));
    if (!sku && !name) continue;
    const issues: string[] = [];
    if (!sku) issues.push('Missing SKU');
    if (!name) issues.push('Missing description');
    const status = cellText(get('status'));
    const modeTxt = cellText(get('mode')).toLowerCase();
    const mode: 'each' | 'box' = /box/.test(modeTxt) ? 'box' : 'each';
    const stratTxt = cellText(get('strategy')).toLowerCase();
    const strategy: 'truck' | 'warehouse' | 'job' = /job|buy|order/.test(stratTxt) ? 'job' : /ware/.test(stratTxt) ? 'warehouse' : 'truck';
    if (stratTxt && !/job|buy|order|ware|truck|stock/.test(stratTxt)) issues.push(`Unknown strategy "${cellText(get('strategy'))}" → truck`);
    const ownerTxt = cellText(get('owner')).toLowerCase();
    const owner: 'manager' | 'owner' = /owner/.test(ownerTxt) ? 'owner' : 'manager';
    const n = (v: Cell, label: string) => {
      const x = toNum(v);
      if (x != null && Number.isNaN(x)) { issues.push(`${label}: "${cellText(v)}" isn't a number`); return null; }
      return x;
    };
    const upb = n(get('upb'), 'Pieces / box');
    if (mode === 'box' && !upb) issues.push('Box item without pieces per box');
    const annual = n(get('annual'), 'Est. annual use') ?? 0;
    const mm = parseMinMax(get('minmax'));
    if (!mm.ok) issues.push(`Min/Max override "${cellText(get('minmax'))}" not understood`);
    const notes = cellText(get('notes'));
    out.push({
      row: r + 1,
      status,
      confirmed: !cols.status || /^confirmed$/i.test(status),
      values: {
        sku, name,
        category: cellText(get('category')) || null,
        mode, strategy, owner,
        units_per_box: mode === 'box' ? upb : null,
        monthly_usage: Math.round((annual / 12) * 100) / 100,
        min_override: mm.min,
        max_override: mm.max,
        override_note: mm.min != null || mm.max != null ? notes || 'Imported override' : null,
        truck_par: strategy === 'truck' ? n(get('par'), 'Truck par') ?? 0 : 0,
        notes: notes || null,
        needs_confirm: cols.status != null && !/^confirmed$/i.test(status) ? status || 'Confirm details' : null,
      },
      issues,
    });
  }
  return { rows: out, error: null, headerRow: h + 1 };
}
