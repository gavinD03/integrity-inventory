import type { Item, PriceBreak, Settings } from './types';

/** Inverse standard normal CDF (Acklam's approximation). p in (0,1). */
export function zFor(pct: number): number {
  const p = Math.min(0.9999, Math.max(0.5, pct / 100));
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  if (p > 1 - plow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function serviceLevel(item: Pick<Item, 'critical' | 'tier'>, s: Settings): number {
  if (item.critical) return s.sl_critical;
  return [s.sl_t1, s.sl_t2, s.sl_t3, s.sl_t4][item.tier - 1];
}

/** Annual holding rate in percent: capital + shrink (+ obsolescence add-on for Tier 4). */
export function holdingRate(item: Pick<Item, 'tier'> | null, s: Settings): number {
  return Number(s.capital_rate) + Number(s.shrink_rate) + (item && item.tier === 4 ? Number(s.tier4_addon) : 0);
}

export interface Step {
  label: string;
  value: string;
}

export interface MinMax {
  perJob: boolean;
  isBox: boolean;
  min: number;
  max: number;
  calcMin: number;
  daysMin: number;
  overridden: boolean;
  boxWarn: boolean;
  steps: Step[];
  unit: string;
}

const r1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/**
 * Weekly-review min/max.
 * Coverage window = order cycle + lead time, because an item that drops just after
 * an order day waits a full cycle before it is even ordered.
 * Each items: min = max(statistical min, days-of-supply floor); max = max(days-of-supply cap, min + one cycle of usage).
 * Everything is in pieces. Box-bought items: max ≥ min + one box, and orders round up to whole boxes.
 */
export function minMax(item: Item, s: Settings): MinMax {
  const isBox = item.mode === 'box';
  const empty: MinMax = { perJob: true, isBox, min: 0, max: 0, calcMin: 0, daysMin: 0, overridden: false, boxWarn: false, steps: [], unit: 'pcs' };
  if (item.strategy === 'job') return empty;

  const level = serviceLevel(item, s);
  const z = zFor(level);
  const usage = Math.max(0, Number(item.monthly_usage) || 0);
  const sd = Math.max(0, Number(item.usage_sd) || 0);
  const lead = Math.max(0, Number(item.lead_days) || 0);
  const cycle = Math.max(0, Number(s.order_cycle_days) || 0);
  const window = lead + cycle;
  const daily = usage / 30;
  const sdDaily = sd / Math.sqrt(30);
  const demand = daily * window;
  const safety = z * sdDaily * Math.sqrt(window);
  const zTxt = z.toFixed(2);

  const upb = isBox ? Math.max(1, Number(item.units_per_box) || 1) : 1;
  const calcMin = Math.ceil(demand + safety);
  const daysMin = Math.ceil(daily * Number(s.min_days_supply));
  const autoMin = Math.max(calcMin, daysMin);
  const daysMax = Math.ceil(daily * Number(s.max_days_supply));
  // Bought by the box: max must leave room for at least one whole box above min, or every order overshoots.
  const autoMax = Math.max(daysMax, autoMin + Math.ceil(daily * cycle), autoMin + upb);
  const overridden = item.min_override != null || item.max_override != null;
  const min = item.min_override != null ? Number(item.min_override) : autoMin;
  const max = item.max_override != null ? Number(item.max_override) : autoMax;
  const steps: Step[] = [
    { label: `Daily usage (${usage} pcs ÷ 30)`, value: daily.toFixed(2) },
    { label: `Window: ${cycle}-day order cycle + ${lead}-day lead time`, value: `${window} days` },
    { label: `Demand over window`, value: r1(demand) },
    { label: `Safety stock (Z ${zTxt} × ${sdDaily.toFixed(2)} × √${window})`, value: r1(safety) },
    { label: 'Statistical min (round up)', value: `${calcMin}` },
    { label: `${s.min_days_supply}-day supply floor`, value: `${daysMin}` },
    { label: 'Min = larger of the two', value: `${autoMin} pcs` },
    { label: isBox ? `Max = larger of ${s.max_days_supply}-day supply, min + one cycle, or min + 1 box (${upb})` : `Max = larger of ${s.max_days_supply}-day supply or min + one cycle`, value: `${autoMax} pcs` },
  ];
  if (isBox) steps.push({ label: 'Orders round up to whole boxes of', value: `${upb} pcs` });
  return { perJob: false, isBox, min, max, calcMin, daysMin, overridden, boxWarn: false, unit: 'pcs', steps };
}

/** What to order to get back to max, rounded up to whole boxes for box-bought items. */
export function orderQty(item: Pick<Item, 'mode' | 'units_per_box'>, onHand: number, max: number) {
  const need = Math.max(0, max - onHand);
  if (item.mode !== 'box') return { pieces: Math.ceil(need), boxes: null as number | null };
  const upb = Math.max(1, Number(item.units_per_box) || 1);
  const boxes = Math.ceil(need / upb);
  return { pieces: boxes * upb, boxes };
}

/** "3 boxes + 12" style display for box-bought items; plain pieces otherwise. */
export function piecesLabel(item: Pick<Item, 'mode' | 'units_per_box'>, pcs: number) {
  if (item.mode !== 'box' || !item.units_per_box || item.units_per_box <= 1) return `${pcs}`;
  const b = Math.floor(pcs / item.units_per_box);
  const loose = pcs - b * item.units_per_box;
  return `${pcs} (${b} bx${loose ? ` + ${loose}` : ''})`;
}

export interface SpareCheck {
  holdCost: number;
  shortCost: number;
  breakEvenPct: number | null;
}

/** Is one extra unit worth holding through the lead time vs. paying the local premium + trip when short? */
export function spareCheck(item: Item, s: Settings): SpareCheck {
  const rate = holdingRate(item, s) / 100;
  const holdCost = Number(item.unit_cost) * rate * (Number(item.lead_days) || 0) / 365;
  const premium = item.backup_price != null ? Math.max(0, Number(item.backup_price) - Number(item.unit_cost)) : 0;
  const shortCost = premium + Number(item.trip_cost || 0);
  return { holdCost, shortCost, breakEvenPct: shortCost > 0 ? (holdCost / shortCost) * 100 : null };
}

export interface BulkInput {
  normalPrice: number;
  normalQty: number;
  bulkPrice: number;
  bulkQty: number;
  usage: number; // units per month
  holdPct: number; // annual %
  tripCost: number; // per normal order avoided
  freight: number; // extra freight for bulk
  shelfMonths: number | null;
  storageMax: number | null;
  cashCap: number | null;
}

export interface BulkResult {
  months: number;
  savings: number;
  ordersAvoided: number;
  tripSave: number;
  extraUnits: number;
  extraValue: number;
  hold: number;
  gross: number;
  net: number;
  discountPct: number;
  breakEvenMonths: number;
  breakEvenRate: number;
  outlay: number;
  extraCash: number;
  pastBreakEven: number;
  verdict: 'buy' | 'approval' | 'no';
  flags: string[];
}

export function bulkCheck(i: BulkInput): BulkResult {
  const nq = Math.max(1, i.normalQty);
  const bq = Math.max(0, i.bulkQty);
  const usage = Math.max(0.0001, i.usage);
  const months = bq / usage;
  const savings = (i.normalPrice - i.bulkPrice) * bq;
  const ordersAvoided = Math.max(0, bq / nq - 1);
  const tripSave = ordersAvoided * i.tripCost;
  const extraUnits = Math.max(0, bq / 2 - nq / 2);
  const extraValue = extraUnits * i.bulkPrice;
  const monthly = i.holdPct / 100 / 12;
  const hold = extraValue * monthly * months;
  const gross = savings + tripSave - i.freight;
  const net = gross - hold;
  const discount = i.normalPrice > 0 ? (i.normalPrice - i.bulkPrice) / i.normalPrice : 0;
  const breakEvenMonths = monthly > 0 ? discount / monthly : Infinity;
  const breakEvenRate = extraValue * months > 0 ? (gross / (extraValue * months)) * 12 * 100 : Infinity;
  const outlay = bq * i.bulkPrice;
  const extraCash = outlay - nq * i.normalPrice;
  const pastBreakEven = Math.max(0, bq - usage * breakEvenMonths);

  const flags: string[] = [];
  let blocked = false;
  if (i.shelfMonths && months > i.shelfMonths) {
    flags.push(`Lasts ${months.toFixed(1)} months, past the ${i.shelfMonths}-month shelf life.`);
    blocked = true;
  }
  if (i.storageMax && bq > i.storageMax) {
    flags.push(`${bq} units won't fit; storage max is ${i.storageMax}.`);
    blocked = true;
  }
  if (net <= 0) {
    flags.push('Holding cost outweighs the savings.');
    blocked = true;
  }
  const overCap = !!i.cashCap && outlay > i.cashCap;
  if (overCap) flags.push(`Cash outlay is over the $${Math.round(i.cashCap!).toLocaleString()} cap.`);
  const verdict = blocked ? 'no' : overCap ? 'approval' : 'buy';

  return { months, savings, ordersAvoided, tripSave, extraUnits, extraValue, hold, gross, net, discountPct: discount * 100, breakEvenMonths, breakEvenRate, outlay, extraCash, pastBreakEven, verdict, flags };
}

/** Normal (single-unit) price and the best bulk price break for an item. */
export function priceOptions(item: Item, breaks: PriceBreak[]) {
  const mine = breaks.filter((b) => b.item_id === item.id && Number(b.min_qty) > 1).sort((a, b) => a.min_qty - b.min_qty);
  return { normal: Number(item.unit_cost), breaks: mine };
}
