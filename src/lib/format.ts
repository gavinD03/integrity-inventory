import type { Ticket, TicketType } from './types';

export const money = (v: number, cents = false) =>
  (v < 0 ? '−$' : '$') +
  Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

export const num = (v: number, digits = 0) =>
  v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

const PREFIX: Record<TicketType, string> = {
  load: 'LD', job: 'JB', transfer: 'TR', adjust: 'AD', receive: 'RC', reverse: 'RV', return: 'RT',
};

export const TYPE_LABEL: Record<TicketType, string> = {
  load: 'Warehouse → truck',
  job: 'Truck → job',
  transfer: 'Truck → truck',
  adjust: 'Adjustment',
  receive: 'Received',
  reverse: 'Reversal',
  return: 'Truck → warehouse',
};

export const ticketCode = (t: Pick<Ticket, 'type' | 'number'>) => `${PREFIX[t.type]}-${String(t.number).padStart(4, '0')}`;

export const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
};

/** Parses one CSV line, honoring quoted fields. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
