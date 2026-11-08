create table if not exists public.pending_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  id_number text not null,
  signup_data jsonb not null,
  password_hash text not null,
  verification_code_hash text not null,
  verification_code_expires_at timestamptz not null,
  verification_attempts integer not null default 0 check (verification_attempts >= 0),
  resend_count integer not null default 1 check (resend_count >= 0),
  last_resend_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pending_signups_email_lower_uidx
  on public.pending_signups (lower(email));

create unique index if not exists pending_signups_id_number_digits_uidx
  on public.pending_signups (regexp_replace(id_number, '[^0-9]', '', 'g'));

create index if not exists pending_signups_created_at_idx
  on public.pending_signups (created_at);

alter table public.pending_signups enable row level security;
revoke all on public.pending_signups from anon, authenticated;
grant all on public.pending_signups to service_role;

create or replace function public.resend_pending_signup(
  p_email text,
  p_verification_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pending public.pending_signups%rowtype;
  current_time_utc timestamptz := now();
begin
  select * into pending
  from public.pending_signups
  where lower(email) = lower(p_email)
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if pending.created_at <= current_time_utc - interval '24 hours' then
    delete from public.pending_signups where id = pending.id;
    return jsonb_build_object('status', 'expired');
  end if;

  if pending.last_resend_at > current_time_utc - interval '60 seconds' then
    return jsonb_build_object(
      'status', 'cooldown',
      'retryAfterSeconds', greatest(1, ceil(extract(epoch from (pending.last_resend_at + interval '60 seconds' - current_time_utc))::numeric)::integer)
    );
  end if;

  if pending.resend_count >= 5
     and pending.last_resend_at > current_time_utc - interval '1 hour' then
    return jsonb_build_object(
      'status', 'rate_limited',
      'retryAfterSeconds', greatest(1, ceil(extract(epoch from (pending.last_resend_at + interval '1 hour' - current_time_utc))::numeric)::integer)
    );
  end if;

  update public.pending_signups
  set verification_code_hash = p_verification_code_hash,
      verification_code_expires_at = current_time_utc + interval '30 minutes',
      verification_attempts = 0,
      resend_count = case
        when pending.last_resend_at <= current_time_utc - interval '1 hour' then 1
        else pending.resend_count + 1
      end,
      last_resend_at = current_time_utc,
      updated_at = current_time_utc
  where id = pending.id;

  return jsonb_build_object('status', 'sent');
end;
$$;

create or replace function public.verify_and_promote_pending_signup(
  p_email text,
  p_verification_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pending public.pending_signups%rowtype;
  user_record public.users%rowtype;
  created_user public.users%rowtype;
  current_time_utc timestamptz := now();
begin
  select * into pending
  from public.pending_signups
  where lower(email) = lower(p_email)
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if pending.created_at <= current_time_utc - interval '24 hours' then
    delete from public.pending_signups where id = pending.id;
    return jsonb_build_object('status', 'expired');
  end if;

  if pending.verification_code_expires_at <= current_time_utc then
    return jsonb_build_object('status', 'code_expired');
  end if;

  if pending.verification_attempts >= 5 then
    return jsonb_build_object('status', 'attempts_exceeded');
  end if;

  if pending.verification_code_hash <> p_verification_code_hash then
    update public.pending_signups
    set verification_attempts = verification_attempts + 1,
        updated_at = current_time_utc
    where id = pending.id;

    if pending.verification_attempts + 1 >= 5 then
      return jsonb_build_object('status', 'attempts_exceeded');
    end if;
    return jsonb_build_object('status', 'invalid_code');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(lower(pending.email), 0));
  perform pg_advisory_xact_lock(hashtextextended(regexp_replace(pending.id_number, '[^0-9]', '', 'g'), 0));

  if exists (
    select 1 from public.users
    where lower(email) = lower(pending.email)
       or regexp_replace(id_number, '[^0-9]', '', 'g') = regexp_replace(pending.id_number, '[^0-9]', '', 'g')
  ) then
    return jsonb_build_object('status', 'account_conflict');
  end if;

  user_record := jsonb_populate_record(
    null::public.users,
    pending.signup_data || jsonb_build_object(
      'password_hash', pending.password_hash,
      'is_verified', true,
      'verified_at', current_time_utc,
      'verification_token', null,
      'verification_token_expires', null
    )
  );

  insert into public.users (
    role,
    id_number,
    last_name,
    first_name,
    middle_name,
    year_level,
    year_graduated,
    department,
    course,
    email,
    password_hash,
    is_verified,
    verified_at,
    verification_token,
    verification_token_expires
  ) values (
    user_record.role,
    user_record.id_number,
    user_record.last_name,
    user_record.first_name,
    user_record.middle_name,
    user_record.year_level,
    user_record.year_graduated,
    user_record.department,
    user_record.course,
    lower(pending.email),
    pending.password_hash,
    true,
    current_time_utc,
    null,
    null
  ) returning * into created_user;

  delete from public.pending_signups where id = pending.id;

  return jsonb_build_object(
    'status', 'verified',
    'userId', created_user.id,
    'email', created_user.email,
    'firstName', created_user.first_name,
    'lastName', created_user.last_name
  );
end;
$$;

revoke all on function public.resend_pending_signup(text, text) from public, anon, authenticated;
revoke all on function public.verify_and_promote_pending_signup(text, text) from public, anon, authenticated;
grant execute on function public.resend_pending_signup(text, text) to service_role;
grant execute on function public.verify_and_promote_pending_signup(text, text) to service_role;

notify pgrst, 'reload schema';