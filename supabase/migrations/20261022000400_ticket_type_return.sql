-- Must run in its own transaction before 20261022000500.
alter type public.ticket_type add value if not exists 'return';
