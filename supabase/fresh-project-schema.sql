-- Fresh, empty-project baseline for TRAC.
-- Run only against the new Supabase project before the feature migrations listed
-- in FRESH_SUPABASE_SETUP.md. This creates schema only; it copies no old data.

create table public.users (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('student', 'alumni')),
  id_number text not null,
  first_name text not null,
  last_name text not null,
  middle_name text,
  year_level text,
  year_graduated text,
  department text not null,
  course text not null,
  email text not null,
  password_hash text not null,
  is_verified boolean not null default false,
  verified_at timestamptz,
  verification_token text,
  verification_token_expires timestamptz,
  reset_token text,
  reset_token_expires timestamptz,
  avatar_url text,
  avatar_public_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index users_email_lower_uidx on public.users (lower(email));
create unique index users_id_number_digits_uidx
  on public.users (regexp_replace(id_number, '[^0-9]', '', 'g'));

create table public.admins (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  email text not null,
  full_name text not null,
  role text not null check (role in ('super_admin', 'admin', 'staff')),
  department text not null default 'CCS',
  is_active boolean not null default true,
  last_login timestamptz,
  avatar_url text,
  avatar_public_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index admins_email_lower_uidx on public.admins (lower(email));
create index admins_active_role_idx on public.admins (is_active, role);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.users(id) on delete restrict,
  sender_id_number text not null,
  sender_name text not null,
  category text not null,
  request_type text not null,
  purpose text,
  additional_remarks text not null default '',
  copies integer not null check (copies > 0),
  tracking_code text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'or_submitted', 'or_rejected', 'or_confirmed', 'processing', 'ready', 'claimed', 'rejected')),
  date_sent timestamptz not null default now(),
  estimated_completion_date timestamptz,
  queue_number integer not null,
  queue_date date not null default current_date,
  department text,
  payment_status text,
  approved_date timestamptz,
  processed_date timestamptz,
  ready_date timestamptz,
  claimed_date timestamptz,
  rejected_date timestamptz,
  rejected_reason text,
  updated_at timestamptz not null default now(),
  status_history jsonb not null default '[]'::jsonb check (jsonb_typeof(status_history) = 'array'),
  fee_amount numeric(12, 2) check (fee_amount is null or fee_amount >= 0),
  fee_unit text,
  fee_total numeric(12, 2) check (fee_total is null or fee_total >= 0),
  processing_days_snapshot integer,
  or_number text,
  or_image_url text,
  or_image_public_id text,
  or_uploaded_at timestamptz,
  or_uploaded_by uuid references public.users(id) on delete set null,
  or_reviewed_at timestamptz,
  or_reviewed_by uuid references public.admins(id) on delete set null,
  or_confirmed_at timestamptz,
  or_rejection_reason text
);

create index requests_sender_date_idx on public.requests (sender_id, date_sent desc);
create index requests_queue_order_idx on public.requests (queue_date, queue_number, date_sent, id);
create index requests_global_daily_limit_idx on public.requests (queue_date);
create index requests_user_daily_limit_idx on public.requests (sender_id, queue_date);
create index requests_or_review_idx on public.requests (status, queue_date, queue_number)
  where status in ('or_submitted', 'or_rejected');

create table public.system_settings (
  id smallint primary key default 1 check (id = 1),
  contact_email text not null default 'registrar@trac.edu.ph',
  office_hours text not null default 'Monday to Friday, 8:00 AM - 4:45 PM',
  daily_queue_limit integer not null default 100 check (daily_queue_limit > 0),
  max_copies_per_request integer not null default 5 check (max_copies_per_request > 0),
  require_purpose boolean not null default true,
  email_notifications jsonb not null default '{"on_new_request":true,"on_status_change":true,"on_completion":true}'::jsonb,
  document_settings jsonb not null default '[
    {"id":"cor","name":"Certificate of Registration (COR)","category":"Document","allowedRoles":["student"],"fee":20,"feeUnit":"per_copy","active":true},
    {"id":"cog","name":"Certificate of Grades (COG)","category":"Document","allowedRoles":["student"],"fee":20,"feeUnit":"per_copy","active":true},
    {"id":"tor","name":"Transcript of Records (TOR)","category":"Document","allowedRoles":["alumni"],"fee":100,"feeUnit":"per_page","active":true},
    {"id":"gwa","name":"General Weighted Average (GWA)","category":"Document","allowedRoles":["alumni"],"fee":70,"feeUnit":"per_copy","active":true},
    {"id":"cav","name":"Certificate of Authentication and Verification (CAV)","category":"Document","allowedRoles":["alumni"],"fee":50,"feeUnit":"per_copy","active":true},
    {"id":"diploma","name":"Diploma","category":"Document","allowedRoles":["alumni"],"fee":0,"feeUnit":"per_copy","active":true},
    {"id":"inc-form","name":"INC Form","category":"Form","allowedRoles":["student"],"fee":15,"feeUnit":"per_subject","active":true},
    {"id":"shifting-form","name":"Shifting Form","category":"Form","allowedRoles":["student"],"fee":0,"feeUnit":"per_copy","active":true}
  ]'::jsonb,
  academic_settings jsonb not null default '[
    {"code":"ICS","name":"Institute of Computing Studies","shortName":"ICS","programs":[{"code":"BSIT","name":"Bachelor of Science in Information Technology","abbr":"BSIT"},{"code":"BSIS","name":"Bachelor of Science in Information Systems","abbr":"BSIS"}]},
    {"code":"ISCJS","name":"Institute of Social and Criminal Justice Studies","shortName":"ISCJS","programs":[{"code":"BSCRIM","name":"Bachelor of Science in Criminology","abbr":"BSCRIM"}]},
    {"code":"IVTES","name":"Institute of Vocational and Technical Education Studies","shortName":"IVTES","programs":[{"code":"BTVTED","name":"Bachelor of Technical-Vocational Teacher Education","abbr":"BTVTED"},{"code":"BTLED","name":"Bachelor of Technology and Livelihood Education","abbr":"BTLED"},{"code":"BSHM","name":"Bachelor of Science in Hospitality Management","abbr":"BSHM"},{"code":"BSHRRM","name":"Bachelor of Science in Hotel and Restaurant Resource Management","abbr":"BSHRRM"},{"code":"BSHT","name":"Bachelor of Science in Hospitality and Tourism","abbr":"BSHT"}]},
    {"code":"IAS","name":"Institute of Agricultural Sciences","shortName":"IAS","programs":[{"code":"BSA","name":"Bachelor of Science in Agriculture","abbr":"BSA"},{"code":"BSF","name":"Bachelor of Science in Forestry","abbr":"BSF"},{"code":"BSAB","name":"Bachelor of Science in Agribusiness","abbr":"BSAB"}]},
    {"code":"GS","name":"Graduate Studies","shortName":"GS","programs":[{"code":"MAEd","name":"Master of Arts in Education","abbr":"MAEd"},{"code":"MSA","name":"Master of Science in Agriculture","abbr":"MSA"},{"code":"MSAgEd","name":"Master of Science in Agricultural Education","abbr":"MSAgEd"},{"code":"MSAg.Mgt.","name":"Master of Science in Agricultural Management","abbr":"MSAg.Mgt."}]}
  ]'::jsonb,
  activity_calendar jsonb not null default '{
    "schoolYearStartMonth": 8,
    "semesters": {
      "first": {"startMonth": 8, "endMonth": 12},
      "second": {"startMonth": 1, "endMonth": 5},
      "summer": {"startMonth": 6, "endMonth": 7}
    }
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.system_settings (id) values (1);

create table public.email_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.requests(id) on delete set null,
  email_type text not null,
  status text not null check (status in ('sent', 'failed')),
  sent_at timestamptz not null default now(),
  recipient_email text,
  subject text,
  error_message text
);

create index email_logs_request_sent_idx on public.email_logs (request_id, sent_at desc);
create index email_logs_status_sent_idx on public.email_logs (status, sent_at desc);

create table public.admin_activity_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.admins(id) on delete set null,
  request_id uuid references public.requests(id) on delete set null,
  action text not null,
  previous_status text,
  new_status text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index admin_activity_logs_created_idx on public.admin_activity_logs (created_at desc);
create index admin_activity_logs_admin_created_idx on public.admin_activity_logs (admin_id, created_at desc);
create index admin_activity_logs_request_created_idx on public.admin_activity_logs (request_id, created_at desc);

create table public.password_reset_otp (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  code text not null,
  type text not null default 'email' check (type = 'email'),
  expires_at timestamptz not null,
  is_used boolean not null default false,
  created_at timestamptz not null default now()
);

create index password_reset_otp_user_created_idx on public.password_reset_otp (user_id, created_at desc);

alter table public.users enable row level security;
alter table public.admins enable row level security;
alter table public.requests enable row level security;
alter table public.system_settings enable row level security;
alter table public.email_logs enable row level security;
alter table public.admin_activity_logs enable row level security;
alter table public.password_reset_otp enable row level security;

revoke all on public.users, public.admins, public.requests, public.system_settings,
  public.email_logs, public.admin_activity_logs, public.password_reset_otp
  from anon, authenticated;

grant select, insert, update, delete on public.users, public.admins, public.requests,
  public.system_settings, public.email_logs, public.admin_activity_logs,
  public.password_reset_otp to service_role;

comment on table public.admins is 'Application admin profiles. id must equal auth.users.id; never store admin passwords here.';
comment on table public.users is 'Student/alumni application accounts. Authentication remains backend-managed and separate from Supabase Auth.';
comment on table public.system_settings is 'Application settings singleton; id is constrained to 1.';

notify pgrst, 'reload schema';