# Integrity Inventory

Warehouse and truck inventory for Integrity Water Treatment: tech truck view, stock tickets, weekly audits, live min/max, and a bulk-buy holding-cost calculator.

**Stack:** Vite + React + TypeScript, Supabase (Postgres, Auth, row-level security), deployed on Vercel.

## How it works

- **Every stock move is a ticket.** Quantities are never overwritten; on-hand stock is the sum of ticket lines.
  - `LD` warehouse → truck (tech taps **Load truck**)
  - `JB` truck → job (tech closes a job; serial numbers required for serial-tracked items)
  - `TR` truck → truck (pending until the receiving truck confirms; leaves the sender immediately)
  - `RT` truck → warehouse (tech returns unused stock)
  - `RC` received from a supplier, `AD` adjustment, `RV` reversal (office only)
- **Roles**
  - *Tech:* sees only their truck; can load, close jobs, transfer, confirm incoming transfers, and submit truck counts.
  - *Inventory manager:* everything techs can do, for every truck, plus items, prices, min/max, settings, truck assignment, adjustments, flags, reversals, and audits.
  - *Owner:* same as manager, plus managing owner accounts. Keep at least two people with manager or owner access.
- **Min/max (weekly review):** min covers the order cycle + lead time and never drops below the days-of-supply floor (default 30 days); max is the days-of-supply cap (default 45 days) or min + one cycle, whichever is larger. **Everything is in pieces.** Items bought by the box have a box qty: max is at least min + one box, reorders round up to whole boxes ("order 3 boxes (150 pcs)"), and receiving, loading and audits accept boxes (+ loose) and convert to pieces. Overrides require a note.
- **Stock strategy:** *truck* (warehouse + truck par; default under the truck cost limit or critical), *warehouse* (stocked, issued to a job, never truck-stocked), *job* (bought per job, no min/max).
- **Holding rate** = capital rate + shrink (+ Tier 4 obsolescence add-on). Utilities and insurance are excluded as fixed costs. Set these in **Settings**.
- **Audits:** start the weekly audit, count each location blind (expected quantities are hidden until saved), review differences with reasons, then complete. Differences post as adjustment tickets automatically. The audit history shows variance % and shrink $ week over week.

## Inventory page

- **Inventory:** every item, complete or not: warehouse, trucks, on order, min/max, status (OK / Reorder / On order / No usage yet). Label printing.
- **Reorder:** opens with only the items whose warehouse stock + stock on order is at or below min, with a suggested qty back to max (whole boxes). Search or scan to add anything else (e.g. a bulk carbon buy). **Place order** saves one purchase order per supplier (`PO-0001`). Open orders are listed with Receive / Close / Cancel.
- **Receive:** opens with what's outstanding on open orders; "Everything arrived" fills a whole order. Search or scan to add anything not on an order. Short deliveries stay open until the rest arrives or the order is closed. Quantities apply to the oldest open order first.
- Items with no usage (and no manual min) are never flagged as low.

## Inventory settings

- **Item setup:** completion % per SKU and what's missing. Required: usage (or a manual min), price, supplier, box qty for box items, and no open "to confirm" note.
- **Bulk edit:** tick items in Item setup (works with every filter) to set supplier (pulls quoted price + the supplier's lead time), lead time, or box qty / Unknown on all of them at once.
- **Box qty Unknown:** box items with no box qty show “Box qty unknown” and stay incomplete until it's entered.
- **SKU codes**, **Suppliers** (contact, quote email, **standard lead time**: copied to an item when the supplier is set on it; changing it updates items still on the old standard), **Min/max + holding** rules.
- People, trucks and job kits are under **Company settings**.

## SKUs, labels and scanning

- **SKU format** `CATEGORY-MATERIAL-ITEM-SIZE` (e.g. `FIT-PVC-E90-100`); segments that don't apply are dropped, reducers combine sizes (`125100`). The item screen builds the SKU from four dropdowns (plus an optional second size) fed by **Settings → SKU codes**; managers can add codes inline. SKUs are uppercase letters, digits and dashes, unique (a collision offers `-2`, `-3`…).
- **Locking:** once an item has any ticket line or a printed label its SKU can't change (enforced by a database trigger). Archive and recreate to rename.
- **Bin labels:** select items on Inventory → **Print labels** → Avery 5160 (30/page, with "skip first N" for partly used sheets) or 2" × 1" thermal. Barcode = Code 128 of the SKU. Print at 100% / actual size. In testing, SKUs over 15 characters didn't decode on a simulated 203 dpi thermal printer; use 300 dpi or Avery sheets for those.
- **Manufacturer barcodes (UPC/EAN):** never generated. Link them on the item screen (scan or type), from any scan screen when a code is unknown (managers), with **pieces per scan** (box UPC = whole box). A code linked to another item is refused with that item named.
- **Scanning:** phone camera (BarcodeDetector where available, ZXing elsewhere incl. iOS Safari) or a USB/Bluetooth scanner, on Load truck, Transfer, **Return to warehouse**, Close a job, Receive delivery and audit counts. Lookup: SKU first, then linked barcodes. Each scan adds pieces-per-scan; repeat scans increment.

## Supplier quotes (managers and owners only)

1. **Quotes → New quote:** a title, a date and an optional note.
2. **Generate request:** pick a supplier, select items (search, category, "Top N by spend", or copy a previous request), then generate. You get a PDF (to read/print) and an Excel reply sheet. The request records exactly which items each supplier was asked for.
3. **Upload reply:** drop the returned `.xlsx`/`.csv`. The header row is found automatically and columns can be in any order. Rows match by SKU; unmatched rows can be mapped by hand or ignored. Warnings (missing pack size, bulk ≥ list, pack size differs from ours, >50% below best) never block saving. Re-uploading replaces that supplier's prices for that quote.
4. **Enter by hand** for suppliers who write on the PDF.
5. **Compare:** best list and bulk $/pc per item, current supplier price, gap %, and overpaying $/yr = (current − best list) × annual pieces, sorted by overpaying. Rows at or above the gap flag (Settings, default 10%) are highlighted. Expand a row to **Set as current supplier**, **Save bulk price**, or **Run bulk check**.

**Quote sheet columns:** SKU, Description, Est. annual qty, Box qty, **Retail price each (1-off)**, **Bulk price each**, **Bulk qty (pcs)**, Bulk savings % (formula), Notes. Every item is pre-selected. Retail is the price of one piece bought on its own, so bulk savings % = 1 − bulk ÷ retail. Costs, quotes and price breaks are all per piece; **Set as current supplier** also adopts that supplier's box qty.

**Cost follows the supplier's latest quote (automatic):** setting or changing an item's supplier pulls that supplier's most recent saved retail price for it (unless you typed a new price in the same save), and saving a quote updates every item that has that supplier set. "Most recent" = latest quote date, then latest upload; drafts never apply. Box qty is filled from the quote only for box items that don't have one.

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
