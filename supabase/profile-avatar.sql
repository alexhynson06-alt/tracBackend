alter table public.users
  add column if not exists avatar_url text,
  add column if not exists avatar_public_id text;

alter table public.admins
  add column if not exists avatar_url text,
  add column if not exists avatar_public_id text;

notify pgrst, 'reload schema';