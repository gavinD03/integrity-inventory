import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { QuoteLine, QuoteRound, SupplierQuote } from '../../../lib/types';

export function useRounds() {
  const [rounds, setRounds] = useState<QuoteRound[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase.from('quote_rounds').select('*').order('opened_at', { ascending: false }).order('label', { ascending: false });
    setRounds((data as QuoteRound[]) ?? []);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { rounds, loaded, reload: load };
}

export function useRoundData(roundId: string | null) {
  const [quotes, setQuotes] = useState<SupplierQuote[]>([]);
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!roundId) { setQuotes([]); setLines([]); return; }
    setLoading(true);
    const q = await supabase.from('supplier_quotes').select('*').eq('round_id', roundId);
    if (q.error) { setError(q.error.message); setLoading(false); return; }
    const qs = (q.data as SupplierQuote[]) ?? [];
    let ls: QuoteLine[] = [];
    if (qs.length) {
      // page through lines (PostgREST caps responses at 1000 rows)
      const ids = qs.map((x) => x.id);
      for (let from = 0; ; from += 1000) {
        const r = await supabase.from('supplier_quote_lines').select('*').in('quote_id', ids).range(from, from + 999);
        if (r.error) { setError(r.error.message); break; }
        const chunk = (r.data as QuoteLine[]) ?? [];
        ls = ls.concat(chunk);
        if (chunk.length < 1000) break;
      }
    }
    setQuotes(qs);
    setLines(ls.map(numLine));
    setError(null);
    setLoading(false);
  }, [roundId]);

  useEffect(() => { load(); }, [load]);
  return { quotes, lines, loading, error, reload: load };
}

function numLine(l: QuoteLine): QuoteLine {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    ...l,
    pieces_per_pack: n(l.pieces_per_pack),
    list_pack_price: n(l.list_pack_price),
    list_unit_price: n(l.list_unit_price),
    bulk_qty: n(l.bulk_qty),
    bulk_unit_price: n(l.bulk_unit_price),
  };
}

/** Requested lines across every round for one supplier, newest first — for "Copy selection from". */
export async function previousRequests() {
  const { data } = await supabase
    .from('supplier_quotes')
    .select('id, supplier_id, status, requested_at, uploaded_at, round_id, quote_rounds(label), supplier_quote_lines(item_id, requested)')
    .order('requested_at', { ascending: false, nullsFirst: false });
  type Row = {
    id: string; supplier_id: string; status: string; round_id: string;
    quote_rounds: { label: string } | { label: string }[] | null;
    supplier_quote_lines: { item_id: string | null; requested: boolean }[];
  };
  return ((data as Row[]) ?? []).map((r) => {
    const round = Array.isArray(r.quote_rounds) ? r.quote_rounds[0] : r.quote_rounds;
    return {
      id: r.id,
      supplierId: r.supplier_id,
      roundId: r.round_id,
      roundLabel: round?.label ?? '',
      itemIds: r.supplier_quote_lines.filter((l) => l.requested && l.item_id).map((l) => l.item_id as string),
    };
  }).filter((r) => r.itemIds.length > 0);
}
