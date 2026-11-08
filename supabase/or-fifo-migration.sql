-- OR upload and FIFO review fields.
-- Apply after backing up the requests table in the target Supabase project.

alter table public.requests
  add column if not exists or_image_url text,
  add column if not exists or_image_public_id text,
  add column if not exists or_uploaded_at timestamptz,
  add column if not exists or_uploaded_by uuid,
  add column if not exists or_reviewed_at timestamptz,
  add column if not exists or_reviewed_by uuid,
  add column if not exists or_confirmed_at timestamptz,
  add column if not exists or_rejection_reason text;

-- Keep the database status constraint aligned with the OR review workflow.
alter table public.requests
  drop constraint if exists requests_status_check;

alter table public.requests
  add constraint requests_status_check
  check (status in (
    'pending',
    'approved',
    'or_submitted',
    'or_rejected',
    'or_confirmed',
    'processing',
    'ready',
    'claimed',
    'rejected'
  ));

create index if not exists requests_fifo_order_idx
  on public.requests (queue_date asc, queue_number asc, date_sent asc, id asc);

create index if not exists requests_or_review_idx
  on public.requests (status, queue_date asc, queue_number asc)
  where status in ('or_submitted', 'or_rejected');

comment on column public.requests.or_image_url is 'Public R2 URL for the uploaded official receipt image';
comment on column public.requests.or_image_public_id is 'R2 object key used to replace or delete the receipt image';
comment on column public.requests.or_rejection_reason is 'Admin reason when an uploaded official receipt needs correction';

notify pgrst, 'reload schema';
