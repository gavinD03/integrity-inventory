import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { must, supabase } from './supabase';
import type { Item, ItemBarcode, Kit, Location, PriceBreak, Profile, Settings, SkuCode, StockRow, Supplier } from './types';

export type ScanResult =
  | { kind: 'item'; item: Item; pieces: number; via: 'sku' | 'barcode'; code: string; label: string | null }
  | { kind: 'inactive'; name: string; code: string }
  | { kind: 'unknown'; code: string };

interface Data {
  me: Profile;
  isManager: boolean;
  locations: Location[];
  items: Item[];
  breaks: PriceBreak[];
  settings: Settings;
  kits: Kit[];
  stock: StockRow[];
  suppliers: Supplier[];
  skuCodes: SkuCode[];
  barcodes: ItemBarcode[];
  /** Lookup order: items.sku (case-insensitive), then linked manufacturer barcodes. */
  resolveScan: (code: string) => Promise<ScanResult>;
  supplierName: (id: string | null | undefined) => string;
  loading: boolean;
  refresh: () => Promise<void>;
  qty: (itemId: string, locationId: string | null | undefined) => number;
  itemById: (id: string) => Item | undefined;
  locName: (id: string | null | undefined) => string;
  warehouse: Location | undefined;
  trucks: Location[];
}

const Ctx = createContext<Data | null>(null);

export function DataProvider({ me, children }: { me: Profile; children: ReactNode }) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [breaks, setBreaks] = useState<PriceBreak[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [kits, setKits] = useState<Kit[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [skuCodes, setSkuCodes] = useState<SkuCode[]>([]);
  const [barcodes, setBarcodes] = useState<ItemBarcode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [l, i, b, s, k, st, sup, sc, bc] = await Promise.all([
        supabase.from('locations').select('*').eq('active', true).order('sort'),
        supabase.from('items').select('*').eq('active', true).order('name'),
        supabase.from('price_breaks').select('*').order('min_qty'),
        supabase.from('app_settings').select('*').eq('id', 1).single(),
        supabase.from('kits').select('id, name, kit_items(item_id, qty)').order('name'),
        supabase.rpc('stock_by_location'),
        me.role === 'tech' ? Promise.resolve({ data: [], error: null }) : supabase.from('suppliers').select('*').order('name'),
        supabase.from('sku_codes').select('*').order('code'),
        supabase.from('item_barcodes').select('id, item_id, code, pieces_per_scan, label'),
      ]);
      setLocations(must(l) as Location[]);
      setItems((must(i) as Item[]).map(normItem));
      setBreaks((must(b) as PriceBreak[]).map((x) => ({ ...x, min_qty: Number(x.min_qty), unit_price: Number(x.unit_price) })));
      setSettings(normSettings(must(s) as Settings));
      setKits(must(k) as Kit[]);
      setSuppliers(must(sup) as Supplier[]);
      setSkuCodes(must(sc) as SkuCode[]);
      setBarcodes((must(bc) as ItemBarcode[]).map((x) => ({ ...x, pieces_per_scan: Number(x.pieces_per_scan) })));
      setStock((must(st) as StockRow[]).map((r) => ({ ...r, qty: Number(r.qty) })));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [me.role]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<Data | null>(() => {
    if (!settings) return null;
    const stockMap = new Map(stock.map((r) => [`${r.item_id}:${r.location_id}`, r.qty]));
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const locMap = new Map(locations.map((l) => [l.id, l]));
    return {
      me,
      isManager: me.role !== 'tech',
      locations, items, breaks, settings, kits, stock, suppliers, skuCodes, barcodes, loading, refresh,
      resolveScan: async (raw) => {
        const code = raw.trim();
        if (!code) return { kind: 'unknown', code };
        const lc = code.toLowerCase();
        const bySku = items.find((i) => i.sku && i.sku.toLowerCase() === lc);
        if (bySku) return { kind: 'item', item: bySku, pieces: 1, via: 'sku', code, label: null };
        // UPC-A and EAN-13 are the same number with/without a leading 0; scanners report either.
        const alts = /^\d{12}$/.test(code) ? [code, `0${code}`] : /^0\d{12}$/.test(code) ? [code, code.slice(1)] : [code];
        const bc = barcodes.find((b) => alts.includes(b.code));
        if (bc) {
          const it = itemMap.get(bc.item_id);
          if (it) return { kind: 'item', item: it, pieces: bc.pieces_per_scan, via: 'barcode', code, label: bc.label };
        }
        // Not among active items: check whether it belongs to an inactive one.
        const { data } = await supabase.from('items').select('name, active').ilike('sku', code.replace(/[%_]/g, '')).limit(1);
        if (data && data[0] && !data[0].active) return { kind: 'inactive', name: data[0].name, code };
        if (bc) {
          const r = await supabase.from('items').select('name').eq('id', bc.item_id).single();
          if (r.data) return { kind: 'inactive', name: r.data.name, code };
        }
        return { kind: 'unknown', code };
      },
      supplierName: (id) => (id ? suppliers.find((x) => x.id === id)?.name ?? '—' : '—'),
      qty: (itemId, locId) => (locId ? stockMap.get(`${itemId}:${locId}`) ?? 0 : 0),
      itemById: (id) => itemMap.get(id),
      locName: (id) => (id ? locMap.get(id)?.name ?? 'Unknown' : '—'),
      warehouse: locations.find((l) => l.kind === 'warehouse'),
      trucks: locations.filter((l) => l.kind === 'truck'),
    };
  }, [me, locations, items, breaks, settings, kits, stock, suppliers, skuCodes, barcodes, loading, refresh]);

  if (error && !value) return <div className="center-msg">Couldn't load data: {error}</div>;
  if (!value) return <div className="center-msg">Loading…</div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): Data {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData outside DataProvider');
  return v;
}

function normItem(i: Item): Item {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    ...i,
    unit_cost: Number(i.unit_cost),
    monthly_usage: Number(i.monthly_usage),
    usage_sd: Number(i.usage_sd),
    lead_days: Number(i.lead_days),
    trip_cost: Number(i.trip_cost),
    truck_par: Number(i.truck_par),
    units_per_box: n(i.units_per_box),
    backup_price: n(i.backup_price),
    shelf_life_months: n(i.shelf_life_months),
    storage_max: n(i.storage_max),
    min_override: n(i.min_override),
    max_override: n(i.max_override),
  };
}

function normSettings(s: Settings): Settings {
  const out = { ...s } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (k !== 'updated_at' && out[k] != null && !isNaN(Number(out[k]))) out[k] = Number(out[k]);
  return out as unknown as Settings;
}
