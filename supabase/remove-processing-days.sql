-- Run before deploying the backend that no longer sends estimated completion or processing days.
-- Existing values are kept; new requests simply leave them empty.

alter table public.requests
  alter column estimated_completion_date drop not null,
  alter column processing_days_snapshot drop not null;
