# Integrity Inventory

Warehouse and truck inventory for Integrity Water Treatment: tech truck view, stock tickets, weekly audits, live min/max, and a bulk-buy holding-cost calculator.

**Stack:** Vite + React + TypeScript, Supabase (Postgres, Auth, row-level security), deployed on Vercel.

## How it works

- **Every stock move is a ticket.** Quantities are never overwritten; on-hand stock is the sum of ticket lines.
  - `LD` warehouse → truck (tech taps **Load truck**)
  - `JB` truck → job (tech closes a job; serial numbers required for serial-tracked items)
  - `TR` truck → truck (pending until the receiving truck confirms; leaves the sender immediately)
  - `RC` received from a supplier, `AD` adjustment, `RV` reversal (office only)
- **Roles**
  - *Tech:* sees only their truck; can load, close jobs, transfer, confirm incoming transfers, and submit truck counts.
  - *Inventory manager:* everything techs can do, for every truck, plus items, prices, min/max, settings, truck assignment, adjustments, flags, reversals, and audits.
  - *Owner:* same as manager, plus managing owner accounts. Keep at least two people with manager or owner access.
- **Min/max (weekly review):** min covers the order cycle + lead time and never drops below the days-of-supply floor (default 30 days); max is the days-of-supply cap (default 45 days) or min + one cycle, whichever is larger. Box items (fittings) use the two-box rule. Overrides require a note.
- **Holding rate** = capital rate + shrink (+ Tier 4 obsolescence add-on). Utilities and insurance are excluded as fixed costs. Set these in **Settings**.
- **Audits:** start the weekly audit, count each location blind (expected quantities are hidden until saved), review differences with reasons, then complete. Differences post as adjustment tickets automatically. The audit history shows variance % and shrink $ week over week.

## First-time setup

1. **Deploy on Vercel:** vercel.com → Add New → Project → import `gavinD03/integrity-inventory` → Deploy. No settings or env vars needed (Vite is auto-detected; the Supabase URL and publishable key have defaults in `src/lib/supabase.ts`, and can be overridden with the variables in `.env.example`).
2. **Accounts:** there is no public sign-up and no email verification. The inventory manager adds each person in **Settings** with a name, email, temporary password, role, and truck, then hands them the password. People can change their password after signing in; the manager can reset it or disable sign-in at any time. (If no owner exists yet, the sign-in page offers a one-time "Set up the owner account" form.) Accounts are created by the `admin-users` edge function in `supabase/functions/`; the database rejects any account not created through it.
3. **Add items:** one at a time, or **Import CSV** on the Inventory page. Columns (header row required, any order): `name, sku, category, mode (each/box), tier, unit_cost, units_per_box, monthly_usage, usage_sd, lead_days, truck_par, critical, serial_tracked, strategy (stock/job), supplier, backup_price`.
4. **Run the first audit as your baseline:** count everything in the warehouse and on every truck. Completing it posts the opening quantities as overage adjustments.
5. Create **job kits** (for example "Softener install") in Settings so techs get a pre-filled parts list.

## Develop

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # calculator unit tests
npm run build
```

Database migrations are in `supabase/migrations/` (already applied to the `iwt-inventory` project).
