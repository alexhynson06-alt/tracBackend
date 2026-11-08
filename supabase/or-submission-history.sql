-- Preserve every official receipt upload and review decision for admin audit.
-- Apply after backing up the requests table in the target Supabase project.

create table if not exists public.request_or_submissions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  or_number text not null,
  image_url text not null,
  image_public_id text not null,
  submitted_at timestamptz not null default now(),
  submitted_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  reviewed_by uuid references public.admins(id) on delete set null,
  decision text check (decision in ('confirmed', 'rejected')),
  rejection_reason text,
  constraint request_or_submissions_attempt_unique unique (request_id, attempt_number),
  constraint request_or_submissions_id_request_unique unique (id, request_id)
);

create index if not exists request_or_submissions_request_order_idx
  on public.request_or_submissions (request_id, attempt_number desc);

-- Link pre-existing latest receipt data to its initial history record.
insert into public.request_or_submissions (
  request_id,
  attempt_number,
  or_number,
  image_url,
  image_public_id,
  submitted_at,
  submitted_by,
  reviewed_at,
  reviewed_by,
  decision,
  rejection_reason
)
select
  request.id,
  1,
  coalesce(nullif(request.or_number, ''), 'Unknown'),
  request.or_image_url,
  coalesce(nullif(request.or_image_public_id, ''), 'legacy/' || request.id::text),
  coalesce(request.or_uploaded_at, request.updated_at, request.date_sent, now()),
  request.or_uploaded_by,
  request.or_reviewed_at,
  request.or_reviewed_by,
  case
    when request.status = 'or_rejected' then 'rejected'
    when request.status in ('or_confirmed', 'processing', 'ready', 'claimed') then 'confirmed'
    else null
  end,
  request.or_rejection_reason
from public.requests as request
where request.or_image_url is not null
on conflict (request_id, attempt_number) do nothing;

alter table public.request_or_submissions enable row level security;
revoke all on public.request_or_submissions from public, anon, authenticated;
grant select, insert, update, delete on public.request_or_submissions to service_role;

drop function if exists public.submit_request_or(uuid, uuid, text, text, text, timestamptz);
create function public.submit_request_or(
  p_request_id uuid,
  p_user_id uuid,
  p_or_number text,
  p_image_url text,
  p_image_public_id text,
  p_submitted_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_request public.requests%rowtype;
  next_attempt integer;
  updated_request public.requests%rowtype;
begin
  select * into current_request
  from public.requests
  where id = p_request_id and sender_id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Request not found.';
  end if;

  if current_request.status not in ('approved', 'or_rejected') then
    raise exception using errcode = 'P0001', message = 'This request is not waiting for an official receipt upload.';
  end if;

  select coalesce(max(attempt_number), 0) + 1 into next_attempt
  from public.request_or_submissions
  where request_id = p_request_id;

  insert into public.request_or_submissions (
    request_id, attempt_number, or_number, image_url, image_public_id, submitted_at, submitted_by
  ) values (
    p_request_id, next_attempt, p_or_number, p_image_url, p_image_public_id, p_submitted_at, p_user_id
  );

  update public.requests
  set status = 'or_submitted',
      or_number = p_or_number,
      or_image_url = p_image_url,
      or_image_public_id = p_image_public_id,
      or_uploaded_at = p_submitted_at,
      or_uploaded_by = p_user_id,
      or_reviewed_at = null,
      or_reviewed_by = null,
      or_confirmed_at = null,
      or_rejection_reason = null,
      updated_at = p_submitted_at,
      status_history = coalesce(status_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'status', 'or_submitted',
        'timestamp', p_submitted_at,
        'previous_status', current_request.status,
        'reason', null
      ))
  where id = p_request_id
  returning * into updated_request;

  return to_jsonb(updated_request);
end;
$$;

revoke all on function public.submit_request_or(uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.submit_request_or(uuid, uuid, text, text, text, timestamptz) to service_role;

drop function if exists public.review_request_or(uuid, text, text, uuid, text, text, timestamptz);
create function public.review_request_or(
  p_request_id uuid,
  p_expected_image_public_id text,
  p_expected_image_url text,
  p_admin_id uuid,
  p_decision text,
  p_rejection_reason text,
  p_reviewed_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_request public.requests%rowtype;
  active_submission public.request_or_submissions%rowtype;
  next_status text;
  updated_request public.requests%rowtype;
begin
  if p_decision not in ('confirmed', 'rejected') then
    raise exception using errcode = 'P0001', message = 'Invalid OR review decision.';
  end if;

  select * into current_request
  from public.requests
  where id = p_request_id
  for update;

  if not found or current_request.status <> 'or_submitted'
      or current_request.or_image_public_id is distinct from p_expected_image_public_id
      or current_request.or_image_url is distinct from p_expected_image_url then
    raise exception using errcode = 'P0001', message = 'The receipt changed before it could be reviewed. Refresh and review the latest submission.';
  end if;

  select * into active_submission
  from public.request_or_submissions
  where request_id = p_request_id
    and image_url = p_expected_image_url
  order by attempt_number desc
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Receipt history is missing for this submission.';
  end if;

  if p_decision = 'rejected' and nullif(trim(p_rejection_reason), '') is null then
    raise exception using errcode = 'P0001', message = 'A rejection reason is required.';
  end if;

  next_status := case when p_decision = 'confirmed' then 'or_confirmed' else 'or_rejected' end;

  update public.request_or_submissions
  set reviewed_at = p_reviewed_at,
      reviewed_by = p_admin_id,
      decision = p_decision,
      rejection_reason = case when p_decision = 'rejected' then trim(p_rejection_reason) else null end
  where id = active_submission.id;

  update public.requests
  set status = next_status,
      or_reviewed_at = p_reviewed_at,
      or_reviewed_by = p_admin_id,
      or_rejection_reason = case when p_decision = 'rejected' then trim(p_rejection_reason) else null end,
      or_confirmed_at = case when p_decision = 'confirmed' then p_reviewed_at else null end,
      updated_at = p_reviewed_at,
      status_history = coalesce(status_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'status', next_status,
        'timestamp', p_reviewed_at,
        'admin_id', p_admin_id,
        'previous_status', current_request.status,
        'reason', case when p_decision = 'rejected' then trim(p_rejection_reason) else null end
      ))
  where id = p_request_id
  returning * into updated_request;

  return to_jsonb(updated_request);
end;
$$;

revoke all on function public.review_request_or(uuid, text, text, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.review_request_or(uuid, text, text, uuid, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
