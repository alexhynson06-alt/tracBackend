-- In-app notifications for admins (e.g. a student uploaded an Official Receipt).
-- Written by the backend with the service role; admins read them through the API only.

create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null,
  request_id uuid,
  type text not null,
  title text not null,
  message text not null,
  link text,
  event_key text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint admin_notifications_admin_event_uidx unique (admin_id, event_key)
);

create index if not exists admin_notifications_admin_created_idx
  on public.admin_notifications (admin_id, created_at desc);

create index if not exists admin_notifications_admin_unread_idx
  on public.admin_notifications (admin_id)
  where is_read = false;

alter table public.admin_notifications enable row level security;
revoke all on public.admin_notifications from public, anon, authenticated;
