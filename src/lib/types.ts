export type Role = 'tech' | 'manager' | 'owner';
export type TicketType = 'load' | 'job' | 'transfer' | 'adjust' | 'receive' | 'reverse';
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
  strategy: 'stock' | 'job';
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
