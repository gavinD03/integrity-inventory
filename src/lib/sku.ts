// SKU format: CATEGORY-MATERIAL-ITEM-SIZE. Segments that don't apply are dropped.
// Sizes: 100 = 1", 075 = 3/4" … Two sizes combine into one segment: 125100 = 1-1/4" x 1".
import type { SkuCode, SkuSegment } from './types';

export const SEGMENTS: SkuSegment[] = ['category', 'material', 'item', 'size'];
export const SEGMENT_LABEL: Record<SkuSegment, string> = { category: 'Category', material: 'Material', item: 'Item type', size: 'Size' };

export interface SkuParts {
  category: string;
  material: string;
  item: string;
  size: string;
  size2: string; // optional second size for reducers (125 + 100 → 125100)
}

export const emptyParts = (): SkuParts => ({ category: '', material: '', item: '', size: '', size2: '' });

export const normalizeSku = (s: string) =>
  s.toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

export const validSku = (s: string) => /^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(s);

export function composeSku(p: SkuParts): string {
  const size = p.size && p.size2 ? `${p.size}${p.size2}` : p.size;
  return [p.category, p.material, p.item, size].filter(Boolean).join('-');
}

const isSizeToken = (t: string) => /^\d{3}(\d{3})?$/.test(t);

/** Best-effort split of an existing SKU into segments, using known codes first, then position and pattern. */
export function parseSku(sku: string, codes: SkuCode[]): { parts: SkuParts; guesses: Partial<Record<SkuSegment, boolean>> } {
  const parts = emptyParts();
  const guesses: Partial<Record<SkuSegment, boolean>> = {};
  const tokens = normalizeSku(sku).split('-').filter(Boolean);
  const known = (seg: SkuSegment, t: string) => codes.some((c) => c.segment === seg && c.code === t);
  tokens.forEach((t, idx) => {
    if (idx === 0) { parts.category = t; if (!known('category', t)) guesses.category = true; return; }
    if (isSizeToken(t) && !parts.size) {
      if (t.length === 6) { parts.size = t.slice(0, 3); parts.size2 = t.slice(3); } else parts.size = t;
      if (!known('size', parts.size) || (parts.size2 && !known('size', parts.size2))) guesses.size = true;
      return;
    }
    if (known('material', t) && !parts.material) { parts.material = t; return; }
    if (known('item', t) && !parts.item) { parts.item = t; return; }
    // Unknown token: second position → material if nothing else claims it, otherwise item.
    if (!parts.material && idx === 1 && tokens.length > 2) { parts.material = t; guesses.material = true; return; }
    if (!parts.item) { parts.item = t; guesses.item = true; return; }
    if (!parts.material) { parts.material = t; guesses.material = true; }
  });
  return { parts, guesses };
}

export interface LearnedCode { segment: SkuSegment; code: string; fromSkus: string[] }

/** Codes found in existing SKUs that aren't in sku_codes yet, with the segment each was guessed to be. */
export function learnCodes(skus: string[], codes: SkuCode[]): LearnedCode[] {
  const found = new Map<string, LearnedCode>();
  for (const sku of skus) {
    if (!sku) continue;
    const { parts } = parseSku(sku, codes);
    const add = (segment: SkuSegment, code: string) => {
      if (!code || codes.some((c) => c.segment === segment && c.code === code)) return;
      const key = `${segment}:${code}`;
      if (!found.has(key)) found.set(key, { segment, code, fromSkus: [] });
      const f = found.get(key)!;
      if (f.fromSkus.length < 3) f.fromSkus.push(sku);
    };
    add('category', parts.category);
    add('material', parts.material);
    add('item', parts.item);
    add('size', parts.size);
    add('size', parts.size2);
  }
  return [...found.values()].sort((a, b) => SEGMENTS.indexOf(a.segment) - SEGMENTS.indexOf(b.segment) || a.code.localeCompare(b.code));
}

/** If `sku` is taken, returns the first free `sku-2`, `sku-3`, … */
export function freeSku(sku: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((s) => s.toUpperCase()));
  if (!set.has(sku.toUpperCase())) return sku;
  for (let n = 2; ; n++) {
    const c = `${sku}-${n}`;
    if (!set.has(c.toUpperCase())) return c;
  }
}

/** Human size text for a label, e.g. 125100 → 1-1/4" x 1". */
export function sizeText(sku: string, codes: SkuCode[]): string {
  const { parts } = parseSku(sku, codes);
  const l = (c: string) => codes.find((x) => x.segment === 'size' && x.code === c)?.label ?? '';
  if (!parts.size) return '';
  return parts.size2 ? `${l(parts.size)} x ${l(parts.size2)}`.trim() : l(parts.size);
}
