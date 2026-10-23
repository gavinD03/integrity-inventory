import type { Item } from './types';

export interface Check { key: string; label: string; ok: boolean }

/**
 * What an item needs before the app can order it and keep it in stock.
 * Only fields that block ordering or min/max count; nice-to-haves don't.
 */
export function readiness(i: Item): { checks: Check[]; done: number; total: number; pct: number; missing: Check[]; canCalc: boolean } {
  const stocked = i.strategy !== 'job';
  const hasOverride = i.min_override != null;
  const checks: Check[] = [
    { key: 'sku', label: 'SKU', ok: !!i.sku?.trim() },
    ...(stocked ? [{ key: 'usage', label: 'Usage', ok: Number(i.monthly_usage) > 0 || hasOverride }] : []),
    { key: 'price', label: 'Price', ok: Number(i.unit_cost) > 0 },
    { key: 'supplier', label: 'Supplier', ok: !!i.supplier_id },
    ...(i.mode === 'box' ? [{ key: 'box', label: 'Box qty unknown', ok: Number(i.units_per_box) > 1 }] : []),
    { key: 'confirm', label: 'Confirmed', ok: !i.needs_confirm },
  ];
  const done = checks.filter((c) => c.ok).length;
  return {
    checks, done, total: checks.length,
    pct: Math.round((done / checks.length) * 100),
    missing: checks.filter((c) => !c.ok),
    // Min/max means something only once usage (or a manual min/max) exists.
    canCalc: stocked && (Number(i.monthly_usage) > 0 || hasOverride),
  };
}
