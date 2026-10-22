import { itemPieceCost } from '../../../lib/quoteCompare';
import type { QuoteCheckContext } from '../../../lib/quoteParse';
import type { Item, QuoteLine, SupplierQuote } from '../../../lib/types';

/** Context for validation warnings: the item's pack size and the best list $/pc from other suppliers' saved quotes. */
export function checkContext(
  item: Item | undefined,
  supplierId: string,
  quotes: SupplierQuote[],
  lines: QuoteLine[],
): QuoteCheckContext {
  if (!item) return {};
  const otherSaved = new Set(quotes.filter((q) => q.status === 'saved' && q.supplier_id !== supplierId).map((q) => q.id));
  let best: number | null = null;
  for (const l of lines) {
    if (l.item_id !== item.id || !otherSaved.has(l.quote_id) || l.list_unit_price == null) continue;
    if (best == null || l.list_unit_price < best) best = l.list_unit_price;
  }
  if (best == null) best = itemPieceCost(item);
  return { itemMode: item.mode, itemUnitsPerBox: item.units_per_box, bestOtherPerPiece: best && best > 0 ? best : null };
}

export const fmt$ = (v: number | null | undefined, d = 2) =>
  v == null ? '—' : `$${v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
