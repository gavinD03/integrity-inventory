-- Quotes are just a title, a date (opened_at) and a note. No January/July kinds; titles needn't be unique.
alter table public.quote_rounds alter column kind drop not null;
alter table public.quote_rounds drop constraint if exists quote_rounds_label_key;
alter table public.quote_rounds add column if not exists notes text;
-- create_quote_request error now reads "This supplier already sent back prices for this quote" (re-applied 2026-10-22).
