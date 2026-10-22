-- Free-text notes and a 'still needs confirming' marker (null = confirmed).
alter table public.items add column if not exists notes text;
alter table public.items add column if not exists needs_confirm text;
