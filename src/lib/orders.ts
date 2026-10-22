import { useCallback, useEffect, useMemo, useState } from 'react';
import { must, supabase } from './supabase';

export interface PoLine {
  id: string;
  po_id: string;
  item_id: string;
  qty_ordered: number;
  qty_received: number;
  unit_cost: number | null;
  added_by_hand: boolean;
}

export interface PurchaseOrder {
  id: string;
  number: number;
  supplier_id: string | null;
  status: 'open' | 'received' | 'closed' | 'cancelled';
  note: string | null;
  created_at: string;
  closed_at: string | null;
  lines: PoLine[];
}

export const poCode = (n: number) => `PO-${String(n).padStart(4, '0')}`;

/** Open orders plus the most recent finished ones. onOrder = pieces ordered but not yet received, per item. */
export function useOrders() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [open, recent] = await Promise.all([
        supabase.from('purchase_orders').select('*, lines:purchase_order_lines(*)').eq('status', 'open').order('created_at'),
        supabase.from('purchase_orders').select('*, lines:purchase_order_lines(*)').neq('status', 'open').order('created_at', { ascending: false }).limit(15),
      ]);
      const norm = (o: PurchaseOrder) => ({
        ...o,
        lines: o.lines.map((l) => ({ ...l, qty_ordered: Number(l.qty_ordered), qty_received: Number(l.qty_received), unit_cost: l.unit_cost == null ? null : Number(l.unit_cost) })),
      });
      setOrders([...(must(open) as PurchaseOrder[]).map(norm), ...(must(recent) as PurchaseOrder[]).map(norm)]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const openOrders = useMemo(() => orders.filter((o) => o.status === 'open'), [orders]);
  const onOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of openOrders) for (const l of o.lines) m.set(l.item_id, (m.get(l.item_id) ?? 0) + Math.max(0, l.qty_ordered - l.qty_received));
    return m;
  }, [openOrders]);

  return { orders, openOrders, onOrder, reload, error, loaded };
}
