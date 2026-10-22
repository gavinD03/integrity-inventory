export type Role = 'tech' | 'manager' | 'owner';
export type TicketType = 'load' | 'job' | 'transfer' | 'adjust' | 'receive' | 'reverse' | 'return';
export type TicketStatus = 'applied' | 'pending' | 'confirmed' | 'cancelled';

export interface Location {
  id: string;
  name: string;
  kind: 'warehouse' | 'truck';
  active: boolean;
  sort: number;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  truck_id: string | null;
  active: boolean;
}

export interface Settings {
  capital_rate: number;
  shrink_rate: number;
  tier4_addon: number;
  order_cycle_days: number;
  min_days_supply: number;
  max_days_supply: number;
  sl_t1: number;
  sl_t2: number;
  sl_t3: number;
  sl_t4: number;
  sl_critical: number;
  cash_cap: number;
  truck_cost_limit: number;
  quote_gap_flag_pct: number;
}

export interface Item {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  mode: 'each' | 'box';
  tier: 1 | 2 | 3 | 4;
  critical: boolean;
  serial_tracked: boolean;
  strategy: 'truck' | 'warehouse' | 'job';
  owner: 'manager' | 'owner';
  supplier_id: string | null;
  unit_cost: number;
  units_per_box: number | null;
  monthly_usage: number;
  usage_sd: number;
  lead_days: number;
  supplier: string | null;
  backup_supplier: string | null;
  backup_price: number | null;
  trip_cost: number;
  shelf_life_months: number | null;
  storage_max: number | null;
  truck_par: number;
  min_override: number | null;
  max_override: number | null;
  override_note: string | null;
  usage_source: string;
  active: boolean;
  sku_locked: boolean;
  label_printed_at: string | null;
  notes: string | null;
  needs_confirm: string | null;
}

export interface PriceBreak {
  id: string;
  item_id: string;
  min_qty: number;
  unit_price: number;
}

export interface TicketLine {
  id: string;
  item_id: string;
  qty: number;
  serial: string | null;
}

export interface Ticket {
  id: string;
  number: number;
  type: TicketType;
  status: TicketStatus;
  from_location_id: string | null;
  to_location_id: string | null;
  job_ref: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  confirmed_at: string | null;
  reverses_ticket_id: string | null;
  reversed_by_ticket_id: string | null;
  flagged: boolean;
  flag_note: string | null;
  audit_id: string | null;
  ticket_lines: TicketLine[];
}

export interface Kit {
  id: string;
  name: string;
  kit_items: { item_id: string; qty: number }[];
}

export interface Audit {
  id: string;
  number: number;
  status: 'open' | 'completed';
  started_by: string | null;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
  order_note: string | null;
}

export interface AuditCount {
  id: string;
  audit_id: string;
  item_id: string;
  location_id: string;
  expected: number;
  counted: number;
  reason: string | null;
  counted_at: string;
}

export interface StockRow {
  item_id: string;
  location_id: string;
  qty: number;
}

export interface Supplier {
  id: string;
  name: string;
  active: boolean;
  notes: string | null;
}

export interface QuoteRound {
  id: string;
  label: string;
  kind: 'full' | 'top' | null;
  notes: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface SupplierQuote {
  id: string;
  round_id: string;
  supplier_id: string;
  file_name: string | null;
  uploaded_at: string;
  requested_at: string | null;
  status: 'requested' | 'draft' | 'saved';
}

export interface QuoteLine {
  id: string;
  quote_id: string;
  item_id: string | null;
  requested: boolean;
  sku_raw: string | null;
  description_raw: string | null;
  pieces_per_pack: number | null;
  list_pack_price: number | null;
  list_unit_price: number | null;
  bulk_qty: number | null;
  bulk_unit_price: number | null;
  notes: string | null;
  match_status: 'matched' | 'unmatched' | 'manual' | 'ignored';
}

export type SkuSegment = 'category' | 'material' | 'item' | 'size';

export interface SkuCode {
  id: string;
  segment: SkuSegment;
  code: string;
  label: string;
  active: boolean;
}

export interface ItemBarcode {
  id: string;
  item_id: string;
  code: string;
  pieces_per_scan: number;
  label: string | null;
}
