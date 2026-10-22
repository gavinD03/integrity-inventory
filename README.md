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
- **Stock strategy:** *truck* (warehouse + truck par; default under the truck cost limit or critical), *warehouse* (stocked, issued to a job, never truck-stocked), *job* (bought per job, no min/max).
- **Holding rate** = capital rate + shrink (+ Tier 4 obsolescence add-on). Utilities and insurance are excluded as fixed costs. Set these in **Settings**.
- **Audits:** start the weekly audit, count each location blind (expected quantities are hidden until saved), review differences with reasons, then complete. Differences post as adjustment tickets automatically. The audit history shows variance % and shrink $ week over week.

## Supplier quotes (managers and owners only)

Twice a year: January = full list, July = top items by spend.

1. **Quotes → New round** (e.g. "2027-01 Full").
2. **Generate request:** pick a supplier, select items (search, category, "Top N by spend", or copy a previous request), then generate. You get a PDF (to read/print) and an Excel reply sheet. The request records exactly which items each supplier was asked for.
3. **Upload reply:** drop the returned `.xlsx`/`.csv`. The header row is found automatically and columns can be in any order. Rows match by SKU; unmatched rows can be mapped by hand or ignored. Warnings (missing pack size, bulk ≥ list, pack size differs from ours, >50% below best) never block saving. Re-uploading replaces that supplier's prices for the round.
4. **Enter by hand** for suppliers who write on the PDF.
5. **Compare:** best list and bulk $/pc per item, current supplier price, gap %, and overpaying $/yr = (current − best list) × annual pieces, sorted by overpaying. Rows at or above the gap flag (Settings, default 10%) are highlighted. Expand a row to **Set as current supplier**, **Save bulk price**, or **Run bulk check**.

**Units:** quotes are compared per piece. For box-tracked items the app divides the per-box cost by pieces per box, and converts back when you set a supplier or save a bulk price (price breaks for box items are stored in boxes).

**Price changes are logged:** every change to an item's cost, supplier, or price breaks — from quotes or from the item screen — is written to `price_change_log` by a database trigger. The Compare view shows the latest changes.

## First-time setup

1. **Deploy on Vercel:** vercel.com → Add New → Project → import `gavinD03/integrity-inventory` → Deploy. No settings or env vars needed (Vite is auto-detected; the Supabase URL and publishable key have defaults in `src/lib/supabase.ts`, and can be overridden with the variables in `.env.example`).
2. **Accounts:** there is no public sign-up and no email verification. The inventory manager adds each person in **Settings** with a name, email, temporary password, role, and truck, then hands them the password. People can change their password after signing in; the manager can reset it or disable sign-in at any time. (If no owner exists yet, the sign-in page offers a one-time "Set up the owner account" form.) Accounts are created by the `admin-users` edge function in `supabase/functions/`; the database rejects any account not created through it.
3. **Add items:** one at a time, or **Import items** on the Inventory page. Columns (header row required, any order): `name, sku, category, mode (each/box), tier, unit_cost, units_per_box, monthly_usage, usage_sd, lead_days, truck_par, critical, serial_tracked, strategy (truck/warehouse/job), supplier, backup_price`. Or upload the master `.xlsx` (Items tab): SKU, Description, Category, Track by, Stock strategy, Owner, Pieces / box, Est. annual use, Min/Max override, Truck par, Notes, Status — matched to existing items by SKU.
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
