-- Atomically create one admin notification per accepted OR submission.
-- Apply after admin-notifications.sql and or-submission-history.sql.

create or replace function public.submit_request_or(
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

  insert into public.admin_notifications (
    admin_id,
    request_id,
    type,
    title,
    message,
    link,
    event_key,
    created_at
  )
  select
    admin.id,
    updated_request.id,
    'or_uploaded',
    'New OR Submitted',
    format(
      '%s submitted an OR for %s. Request ID: %s. Status: OR submitted and awaiting admin review.',
      coalesce(nullif(updated_request.sender_name, ''), 'A student'),
      coalesce(nullif(updated_request.request_type, ''), nullif(updated_request.category, ''), 'document request'),
      updated_request.tracking_code
    ),
    '/admin/requests/' || updated_request.tracking_code,
    'or-upload:' || updated_request.id::text || ':' || p_submitted_at::text,
    p_submitted_at
  from public.admins as admin
  where admin.is_active = true
  on conflict (admin_id, event_key) do nothing;

  return to_jsonb(updated_request);
end;
$$;

revoke all on function public.submit_request_or(uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.submit_request_or(uuid, uuid, text, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';