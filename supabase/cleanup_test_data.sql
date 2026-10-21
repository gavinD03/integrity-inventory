-- One-time cleanup of the two test accounts used to verify the backend on Oct 21, 2026.
-- Their tickets are already cancelled (excluded from stock). Paste into the Supabase SQL editor to remove them fully.
delete from public.ticket_lines where ticket_id in (select id from public.tickets where created_by in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'));
update public.tickets set reversed_by_ticket_id = null, reverses_ticket_id = null where created_by in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
delete from public.tickets where created_by in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
delete from public.audit_counts where counted_by in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
delete from public.audits where started_by in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
delete from auth.users where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
