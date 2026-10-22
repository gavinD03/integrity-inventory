// Comparison math for the Quotes tab. Everything is per PIECE.
// items.unit_cost is per piece for every item.
import type { Item, QuoteLine, Supplier, SupplierQuote } from './types';

export const annualUse = (i: Pick<Item, 'monthly_usage'>) => Number(i.monthly_usage || 0) * 12;

/** Current cost per piece from the item record (null if a box item has no pieces-per-box). */
export function itemPieceCost(i: Pick<Item, 'unit_cost'>): number | null {
  return Number(i.unit_cost);
}

export type CellState = 'quoted' | 'asked' | 'not_asked';

export interface SupplierCell {
  supplierId: string;
  state: CellState;
  line: QuoteLine | null;
  list: number | null; // $/pc
  bulk: number | null; // $/pc
  bulkQty: number | null; // pcs
}

export interface CompareRow {
  item: Item;
  annual: number;
  cells: Record<string, SupplierCell>;
  bestList: { price: number; supplierId: string; line: QuoteLine } | null;
  bestBulk: { price: number; supplierId: string; qty: number; line: QuoteLine; savingsPct: number | null } | null;
  currentSupplierId: string | null;
  currentPrice: number | null;
  currentSource: 'quote' | 'item' | null;
  gapPct: number | null;
  overpay: number; // $/yr, never negative
  flagged: boolean;
}

const hasPrice = (l: QuoteLine) => l.list_unit_price != null || l.bulk_unit_price != null;

export function buildComparison(
  items: Item[],
  suppliers: Supplier[],
  quotes: SupplierQuote[],
  lines: QuoteLine[],
  flagPct: number,
): CompareRow[] {
  const quoteById = new Map(quotes.map((q) => [q.id, q]));
  // item → supplier → best line (requested lines win for "asked" state; priced lines win for prices)
  const byItem = new Map<string, Map<string, QuoteLine[]>>();
  for (const l of lines) {
    if (!l.item_id) continue;
    const q = quoteById.get(l.quote_id);
    if (!q) continue;
    if (!byItem.has(l.item_id)) byItem.set(l.item_id, new Map());
    const m = byItem.get(l.item_id)!;
    if (!m.has(q.supplier_id)) m.set(q.supplier_id, []);
    m.get(q.supplier_id)!.push(l);
  }

  return items.map((item) => {
    const annual = annualUse(item);
    const cells: Record<string, SupplierCell> = {};
    let bestList: CompareRow['bestList'] = null;
    let bestBulk: CompareRow['bestBulk'] = null;
    for (const s of suppliers) {
      const ls = byItem.get(item.id)?.get(s.id) ?? [];
      const q = quotes.find((x) => x.supplier_id === s.id);
      const saved = q?.status === 'saved';
      const priced = saved ? ls.find((l) => hasPrice(l) && l.match_status !== 'ignored') ?? null : null;
      const asked = ls.some((l) => l.requested);
      const state: CellState = priced ? 'quoted' : asked ? 'asked' : 'not_asked';
      const list = priced?.list_unit_price != null ? Number(priced.list_unit_price) : null;
      const bulk = priced?.bulk_unit_price != null ? Number(priced.bulk_unit_price) : null;
      const bulkQty = priced?.bulk_qty != null ? Number(priced.bulk_qty) : null;
      cells[s.id] = { supplierId: s.id, state, line: priced ?? ls.find((l) => l.requested) ?? null, list, bulk, bulkQty };
      if (priced && list != null && (!bestList || list < bestList.price)) bestList = { price: list, supplierId: s.id, line: priced };
      if (priced && bulk != null && bulkQty != null && (!bestBulk || bulk < bestBulk.price)) {
        bestBulk = { price: bulk, supplierId: s.id, qty: bulkQty, line: priced, savingsPct: list != null && list > 0 ? (1 - bulk / list) * 100 : null };
      }
    }
    const currentSupplierId = item.supplier_id;
    let currentPrice: number | null = null;
    let currentSource: CompareRow['currentSource'] = null;
    if (currentSupplierId && cells[currentSupplierId]?.list != null) {
      currentPrice = cells[currentSupplierId].list;
      currentSource = 'quote';
    } else {
      const pc = itemPieceCost(item);
      if (pc != null && pc > 0) { currentPrice = pc; currentSource = 'item'; }
    }
    const gapPct = bestList && currentPrice != null && bestList.price > 0 ? (currentPrice / bestList.price - 1) * 100 : null;
    const overpay = bestList && currentPrice != null ? Math.max(0, (currentPrice - bestList.price) * annual) : 0;
    return {
      item, annual, cells, bestList, bestBulk, currentSupplierId, currentPrice, currentSource, gapPct, overpay,
      flagged: gapPct != null && gapPct >= flagPct,
    };
  });
}

export interface SupplierSpend {
  supplierId: string;
  allItems: number;
  allCount: number;
  common: number;
  byCategory: Record<string, number>;
}

/** Spend per supplier at list price × annual use. "Common" = items every selected supplier quoted a list price for. */
export function supplierSpend(rows: CompareRow[], supplierIds: string[]) {
  const commonRows = rows.filter((r) => supplierIds.length > 0 && supplierIds.every((s) => r.cells[s]?.list != null));
  const out: SupplierSpend[] = supplierIds.map((sid) => {
    let all = 0, cnt = 0;
    const byCategory: Record<string, number> = {};
    for (const r of rows) {
      const p = r.cells[sid]?.list;
      if (p == null) continue;
      const v = p * r.annual;
      all += v; cnt++;
      const c = r.item.category || 'Uncategorized';
      byCategory[c] = (byCategory[c] ?? 0) + v;
    }
    const common = commonRows.reduce((t, r) => t + (r.cells[sid]!.list as number) * r.annual, 0);
    return { supplierId: sid, allItems: all, allCount: cnt, common, byCategory };
  });
  return { perSupplier: out, commonCount: commonRows.length };
}

export function overpayByCategory(rows: CompareRow[]) {
  const m: Record<string, number> = {};
  for (const r of rows) {
    if (r.overpay <= 0) continue;
    const c = r.item.category || 'Uncategorized';
    m[c] = (m[c] ?? 0) + r.overpay;
  }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

/** Annual spend at current cost, per piece × annual pieces. Used for "Top N by spend". */
export function annualSpend(i: Item): number {
  const pc = itemPieceCost(i);
  return pc == null ? 0 : pc * annualUse(i);
}

export function topBySpend(items: Item[], n: number): Item[] {
  return [...items].sort((a, b) => annualSpend(b) - annualSpend(a)).filter((i) => annualSpend(i) > 0).slice(0, n);
}

export function compareCsv(rows: CompareRow[], suppliers: Supplier[], name: (id: string | null) => string): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const f = (v: number | null | undefined, d = 4) => (v == null ? '' : v.toFixed(d));
  const head = ['SKU', 'Name', 'Category', 'Annual use (pcs)',
    ...suppliers.flatMap((s) => [`${s.name} retail $/pc`, `${s.name} bulk $/pc`, `${s.name} bulk qty`, `${s.name} bulk savings %`, `${s.name} box qty`]),
    'Best retail $/pc', 'Best retail supplier', 'Best bulk $/pc', 'Best bulk supplier', 'Best bulk qty', 'Best bulk savings %',
    'Current supplier', 'Current $/pc', 'Gap %', 'Overpaying $/yr'];
  const lines = rows.map((r) => [
    r.item.sku, r.item.name, r.item.category, r.annual,
    ...suppliers.flatMap((s) => {
      const c = r.cells[s.id];
      const sv = c?.list != null && c.list > 0 && c.bulk != null ? (1 - c.bulk / c.list) * 100 : null;
      return [c?.state === 'asked' ? 'asked, not quoted' : f(c?.list), f(c?.bulk), c?.bulkQty ?? '', sv == null ? '' : sv.toFixed(1), c?.line?.pieces_per_pack ?? ''];
    }),
    f(r.bestList?.price), r.bestList ? name(r.bestList.supplierId) : '',
    f(r.bestBulk?.price), r.bestBulk ? name(r.bestBulk.supplierId) : '', r.bestBulk?.qty ?? '', r.bestBulk?.savingsPct == null ? '' : r.bestBulk.savingsPct.toFixed(1),
    name(r.currentSupplierId), f(r.currentPrice), r.gapPct == null ? '' : r.gapPct.toFixed(1), r.overpay.toFixed(2),
  ].map(esc).join(','));
  return [head.map(esc).join(','), ...lines].join('\n');
}
