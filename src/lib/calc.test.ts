import { describe, expect, it } from 'vitest';
import { bulkCheck, minMax, orderQty, piecesLabel, zFor } from './calc';
import type { Item, Settings } from './types';

const settings: Settings = {
  capital_rate: 22, shrink_rate: 2, tier4_addon: 3, order_cycle_days: 7,
  min_days_supply: 30, max_days_supply: 45,
  sl_t1: 98, sl_t2: 95, sl_t3: 98, sl_t4: 90, sl_critical: 99, cash_cap: 8000, truck_cost_limit: 250, quote_gap_flag_pct: 10,
};

const base: Item = {
  id: 'x', name: 'Test', sku: null, category: null, mode: 'each', tier: 3, critical: false,
  serial_tracked: false, strategy: 'truck', owner: 'manager', supplier_id: null, unit_cost: 133, units_per_box: null, monthly_usage: 10,
  usage_sd: 3, lead_days: 3, supplier: null, backup_supplier: null, backup_price: null, trip_cost: 0,
  shelf_life_months: null, storage_max: null, truck_par: 0, min_override: null, max_override: null,
  override_note: null, usage_source: 'supplier history', active: true, sku_locked: false, label_printed_at: null, notes: null, needs_confirm: null,
};

describe('zFor', () => {
  it('matches standard values', () => {
    expect(zFor(95)).toBeCloseTo(1.645, 2);
    expect(zFor(98)).toBeCloseTo(2.054, 2);
    expect(zFor(99)).toBeCloseTo(2.326, 2);
  });
});

describe('bulkCheck', () => {
  it('reproduces the carbon pallet example', () => {
    const r = bulkCheck({ normalPrice: 133, normalQty: 10, bulkPrice: 119, bulkQty: 63, usage: 10, holdPct: 24, tripCost: 0, freight: 0, shelfMonths: 24, storageMax: 80, cashCap: 8000 });
    expect(r.savings).toBe(882);
    expect(r.hold).toBeCloseTo(397.3, 0);
    expect(r.net).toBeCloseTo(484.7, 0);
    expect(r.breakEvenRate).toBeCloseTo(53.3, 0);
    expect(r.verdict).toBe('buy');
  });
  it('blocks when past shelf life', () => {
    const r = bulkCheck({ normalPrice: 133, normalQty: 10, bulkPrice: 119, bulkQty: 63, usage: 10, holdPct: 24, tripCost: 0, freight: 0, shelfMonths: 3, storageMax: null, cashCap: null });
    expect(r.verdict).toBe('no');
  });
});

describe('minMax', () => {
  it('uses the 30-day floor when it exceeds the statistical min', () => {
    const r = minMax(base, settings);
    expect(r.daysMin).toBe(10);
    expect(r.min).toBe(Math.max(r.calcMin, 10));
    expect(r.max).toBeGreaterThanOrEqual(15);
  });
  it('box items: min/max in pieces, max at least min + one box, orders round up to whole boxes', () => {
    const it = { ...base, mode: 'box' as const, units_per_box: 50, monthly_usage: 40, usage_sd: 15, tier: 1 as const };
    const r = minMax(it, settings);
    expect(r.min).toBe(Math.max(r.calcMin, 40));
    expect(r.max).toBeGreaterThanOrEqual(r.min + 50);
    const o = orderQty(it, 10, r.max);
    expect(o.pieces % 50).toBe(0);
    expect(o.pieces).toBeGreaterThanOrEqual(r.max - 10);
    expect(o.boxes).toBe(o.pieces / 50);
    expect(piecesLabel(it, 112)).toBe('112 (2 bx + 12)');
  });
  it('buy-per-job items have no min/max', () => {
    expect(minMax({ ...base, strategy: 'job' }, settings).perJob).toBe(true);
  });
});
