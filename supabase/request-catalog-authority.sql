-- Persist request terms and enforce catalog submission limits atomically.
-- Apply after backing up the requests and system_settings tables.

alter table public.requests
  add column if not exists fee_amount numeric(12, 2),
  add column if not exists fee_unit text,
  add column if not exists fee_total numeric(12, 2),
  add column if not exists processing_days_snapshot integer;

alter table public.system_settings
  add column if not exists academic_settings jsonb not null default '[]'::jsonb;

update public.system_settings
set academic_settings = '[
  {"code":"ICS","name":"Institute of Computing Studies","shortName":"ICS","programs":[{"code":"BSIT","name":"Bachelor of Science in Information Technology","abbr":"BSIT"},{"code":"BSIS","name":"Bachelor of Science in Information Systems","abbr":"BSIS"}]},
  {"code":"ISCJS","name":"Institute of Social and Criminal Justice Studies","shortName":"ISCJS","programs":[{"code":"BSCRIM","name":"Bachelor of Science in Criminology","abbr":"BSCRIM"}]},
  {"code":"IVTES","name":"Institute of Vocational and Technical Education Studies","shortName":"IVTES","programs":[{"code":"BTVTED","name":"Bachelor of Technical-Vocational Teacher Education","abbr":"BTVTED"},{"code":"BTLED","name":"Bachelor of Technology and Livelihood Education","abbr":"BTLED"},{"code":"BSHM","name":"Bachelor of Science in Hospitality Management","abbr":"BSHM"},{"code":"BSHRRM","name":"Bachelor of Science in Hotel and Restaurant Resource Management","abbr":"BSHRRM"},{"code":"BSHT","name":"Bachelor of Science in Hospitality and Tourism","abbr":"BSHT"}]},
  {"code":"IAS","name":"Institute of Agricultural Sciences","shortName":"IAS","programs":[{"code":"BSA","name":"Bachelor of Science in Agriculture","abbr":"BSA"},{"code":"BSF","name":"Bachelor of Science in Forestry","abbr":"BSF"},{"code":"BSAB","name":"Bachelor of Science in Agribusiness","abbr":"BSAB"}]},
  {"code":"GS","name":"Graduate Studies","shortName":"GS","programs":[{"code":"MAEd","name":"Master of Arts in Education","abbr":"MAEd"},{"code":"MSA","name":"Master of Science in Agriculture","abbr":"MSA"},{"code":"MSAgEd","name":"Master of Science in Agricultural Education","abbr":"MSAgEd"},{"code":"MSAg.Mgt.","name":"Master of Science in Agricultural Management","abbr":"MSAg.Mgt."}]}
]'::jsonb
where academic_settings is null or academic_settings = '[]'::jsonb;

update public.system_settings
set document_settings = '[
  {"id":"cor","name":"Certificate of Registration (COR)","fee":20,"processing_days":1,"category":"Document","allowedRoles":["student"],"feeUnit":"per_copy","allowsMultiple":true,"active":true},
  {"id":"cog","name":"Certificate of Grades (COG)","fee":20,"processing_days":1,"category":"Document","allowedRoles":["student"],"feeUnit":"per_copy","allowsMultiple":true,"active":true},
  {"id":"tor","name":"Transcript of Records (TOR)","fee":100,"processing_days":6,"category":"Document","allowedRoles":["alumni"],"feeUnit":"per_page","allowsMultiple":true,"active":true},
  {"id":"gwa","name":"General Weighted Average (GWA)","fee":70,"processing_days":2,"category":"Document","allowedRoles":["alumni"],"feeUnit":"per_copy","allowsMultiple":true,"active":true},
  {"id":"cav","name":"Certificate of Authentication and Verification (CAV)","fee":50,"processing_days":2,"category":"Document","allowedRoles":["alumni"],"feeUnit":"per_copy","allowsMultiple":true,"active":true},
  {"id":"diploma","name":"Diploma","fee":0,"processing_days":3,"category":"Document","allowedRoles":["alumni"],"feeUnit":"per_copy","allowsMultiple":true,"active":true},
  {"id":"inc-form","name":"INC Form","fee":15,"processing_days":1,"category":"Form","allowedRoles":["student"],"feeUnit":"per_subject","allowsMultiple":true,"multipleLabel":"subject","active":true},
  {"id":"shifting-form","name":"Shifting Form","fee":0,"processing_days":1,"category":"Form","allowedRoles":["student"],"feeUnit":"per_copy","allowsMultiple":false,"active":true}
]'::jsonb
where document_settings is null or document_settings = '[]'::jsonb;

create table if not exists public.request_submission_guard (
  id boolean primary key default true check (id),
  created_at timestamptz not null default now()
);

insert into public.request_submission_guard (id)
values (true)
on conflict (id) do nothing;

revoke all on public.request_submission_guard from public, anon, authenticated;

create or replace function public.submit_catalog_request(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  guard_row boolean;
  request_date date;
  daily_limit integer;
  global_count integer;
  user_count integer;
  prior_queue_number integer;
  prior_day_queue_number integer;
  next_queue_number integer;
  inserted_request public.requests%rowtype;
begin
  select id into guard_row
  from public.request_submission_guard
  where id = true
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'REQUEST_GUARD_MISSING';
  end if;

  request_date := (p_request->>'queue_date')::date;

  select coalesce(system_settings.daily_queue_limit, 100)
  into daily_limit
  from public.system_settings
  order by id
  limit 1;
  daily_limit := coalesce(daily_limit, 100);

  select count(*) into global_count
  from public.requests
  where queue_date = request_date;

  if global_count >= daily_limit then
    raise exception using errcode = 'P0001', message = 'GLOBAL_DAILY_LIMIT';
  end if;

  select count(*) into user_count
  from public.requests
  where sender_id = (p_request->>'sender_id')::uuid
    and queue_date = request_date;

  if user_count >= 100 then
    raise exception using errcode = 'P0001', message = 'USER_DAILY_LIMIT';
  end if;

  if exists (
    select 1
    from public.requests
    where sender_id = (p_request->>'sender_id')::uuid
      and request_type = p_request->>'request_type'
      and queue_date = request_date
  ) then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_REQUEST';
  end if;

  select max(queue_number) into prior_queue_number
  from public.requests
  where queue_date = request_date;

  if prior_queue_number is null then
    select max(queue_number) into prior_day_queue_number
    from public.requests
    where queue_date = request_date - 1
      and status not in ('claimed', 'rejected');
    next_queue_number := coalesce(prior_day_queue_number, 0) + 1;
  else
    next_queue_number := prior_queue_number + 1;
  end if;

  insert into public.requests (
    sender_id,
    sender_id_number,
    sender_name,
    category,
    request_type,
    purpose,
    additional_remarks,
    copies,
    tracking_code,
    status,
    estimated_completion_date,
    queue_number,
    queue_date,
    date_sent,
    fee_amount,
    fee_unit,
    fee_total,
    processing_days_snapshot
  ) values (
    (p_request->>'sender_id')::uuid,
    p_request->>'sender_id_number',
    p_request->>'sender_name',
    p_request->>'category',
    p_request->>'request_type',
    p_request->>'purpose',
    coalesce(p_request->>'additional_remarks', ''),
    (p_request->>'copies')::integer,
    p_request->>'tracking_code',
    'pending',
    (p_request->>'estimated_completion_date')::timestamptz,
    next_queue_number,
    request_date,
    (p_request->>'date_sent')::timestamptz,
    (p_request->>'fee_amount')::numeric,
    p_request->>'fee_unit',
    (p_request->>'fee_total')::numeric,
    (p_request->>'processing_days_snapshot')::integer
  ) returning * into inserted_request;

  return to_jsonb(inserted_request);
end;
$$;

revoke all on function public.submit_catalog_request(jsonb) from public, anon, authenticated;
grant execute on function public.submit_catalog_request(jsonb) to service_role;

create index if not exists requests_global_daily_limit_idx
  on public.requests (queue_date);

create index if not exists requests_user_daily_limit_idx
  on public.requests (sender_id, queue_date);

notify pgrst, 'reload schema';