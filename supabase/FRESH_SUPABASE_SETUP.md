# Fresh Supabase Project Setup

This runbook targets a **new, empty Supabase project**. It does not copy data or credentials from the former project. Do not run these files against a populated project without a separately reviewed migration plan.

## 1. Configure the New Project

1. Create a Supabase project and configure Auth email delivery, site URL, and redirect URLs for the deployed Admin app. Invitation and password-recovery links must return to the Admin login/recovery route.
2. Keep the project's service-role key only in the backend secret store. The Admin frontend uses only the project's public URL and anon/publishable key.
3. Set up a staging project first. Do not paste credentials into source files or commit `.env` files.

## 2. Create the Schema

In the new project's SQL Editor, run `fresh-project-schema.sql` first. It creates the application base tables and private-by-default RLS/grants. It intentionally does not create an initial admin profile because that profile must reference a real Auth user UUID.

Then run these feature SQL files in order:

1. `pending-signups.sql` for the existing student signup-verification RPCs and pending-signup table.
2. `request-catalog-authority.sql` for fee snapshots, catalog request submission, request guard, and daily request indexes.
3. `or-fifo-migration.sql` for official-receipt request fields/status support. The baseline already has the runtime `or_number` column.
4. `or-submission-history.sql` for OR history and atomic upload/review RPCs.
5. `admin-notifications.sql` for the Admin notification table.

The baseline already includes avatar columns and activity-calendar settings, so do **not** run `profile-avatar.sql` or `academic-calendar-settings.sql` on top of it. Do not run `academic-catalog.sql` because its empty-catalog update is unnecessary; the baseline has the app defaults. `trac-contact-email.sql` is an old-data update and is not needed. `remove-processing-days.sql` is redundant because the baseline fields are already nullable. Do not run rollback scripts or the legacy-signup cleanup against the empty project.

Before deploying the backend, inspect the SQL Editor results and confirm the tables, RPCs, constraints, indexes, RLS status, and grants exist. The SQL files are source artifacts, not a substitute for a staged execution and review.

### Repair an Existing Deployment Missing Request or OR SQL

The errors `Could not find function public.submit_catalog_request(p_request)` and `Could not find table public.request_or_submissions` / `function public.submit_request_or(...)` mean the corresponding SQL migration was not applied to the Supabase project currently configured in Render. These are database migrations; a backend redeploy alone cannot create them.

For an existing project with requests already in it:

1. Confirm this is the same Supabase project URL configured for the running Render service. Back up or export `public.requests` before running the OR migrations.
2. Check request statuses first. The FIFO migration installs a status check constraint and expects only these values: `pending`, `approved`, `or_submitted`, `or_rejected`, `or_confirmed`, `processing`, `ready`, `claimed`, `rejected`.

```sql
select status, count(*)
from public.requests
group by status
order by status;
```

3. If `submit_catalog_request` is missing, apply `request-catalog-authority.sql` after confirming the baseline tables exist.
4. Apply `or-fifo-migration.sql` first; it adds receipt columns/status support required by the OR history migration.
5. Apply `or-submission-history.sql`; it creates `request_or_submissions` and both `submit_request_or` and `review_request_or`. Its backfill preserves existing latest receipt data as attempt 1 and is repeat-safe for rows already backfilled.
6. Apply `admin-notifications.sql` if the in-app Admin notification on OR upload is enabled. It is idempotent and now explicitly grants the backend service role the needed table access.
7. Verify the objects before retrying the workflow:

```sql
select
  to_regclass('public.request_or_submissions') as request_or_submissions,
  to_regclass('public.admin_notifications') as admin_notifications;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('submit_catalog_request', 'submit_request_or', 'review_request_or')
order by p.proname;
```

The expected OR functions have these signatures: `submit_request_or(uuid, uuid, text, text, text, timestamptz)` and `review_request_or(uuid, text, text, uuid, text, text, timestamptz)`. Then retry an OR upload and review using a test request.

The backend uploads the receipt image before calling `submit_request_or`, but deletes that uploaded object if the database RPC fails. The reported failure path should therefore clean up the failed attempt's R2 object.

These SQL files now send `NOTIFY pgrst, 'reload schema'` after adding tables/functions so PostgREST refreshes its schema cache. If PostgREST still reports a stale schema immediately after a successful migration, run `NOTIFY pgrst, 'reload schema';` in the SQL Editor and retry.

The production logs show existing request rows, so do not rerun `fresh-project-schema.sql` on that database. It is only for a new empty project.

## 3. Create the First SuperAdmin

1. In Supabase Dashboard > Authentication > Users, create/invite the first Admin account using a new email/password. Ensure the email is confirmed before login if the project requires confirmation.
2. Copy that Auth user's UUID from the dashboard.
3. In the SQL Editor, insert its application profile, replacing the example values:

```sql
insert into public.admins (id, username, email, full_name, role, department, is_active)
values (
  'AUTH_USER_UUID',
  'registrar-admin',
  'admin@example.edu',
  'Registrar Administrator',
  'super_admin',
  'ALL',
  true
);
```

The `id` must exactly match `auth.users.id`. Do not add a `password_hash`; Admin passwords belong only to Supabase Auth. The application rejects Auth users without an active `public.admins` profile.

## 4. Configure Applications

Backend secret/environment settings:

```dotenv
SUPABASE_URL=https://YOUR_NEW_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_NEW_SERVER_ONLY_SERVICE_ROLE_KEY
ADMIN_APP_URL=https://YOUR_ADMIN_APP_ORIGIN
JWT_SECRET=YOUR_NEW_RANDOM_STUDENT_JWT_SECRET
```

Admin frontend build environment:

```dotenv
VITE_SUPABASE_URL=https://YOUR_NEW_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_NEW_PUBLIC_ANON_OR_PUBLISHABLE_KEY
VITE_API_URL=https://YOUR_BACKEND_API/api
```

`SUPABASE_SERVICE_ROLE_KEY` must never be supplied to either frontend. Student authentication still uses the backend `JWT_SECRET`; changing it invalidates existing student app JWTs, though a new empty database has no old app sessions to preserve.

## 5. Verify in Staging

- SuperAdmin can sign in with email/password; an Auth user without an active profile is denied.
- Staff invitation creates an Auth identity and a linked `admins` row. Duplicate invitations fail safely; no temporary password is created or emailed.
- Ordinary staff cannot list/create/edit/delete admin users or change roles. Department values do not grant SuperAdmin. The final active SuperAdmin cannot be demoted or deactivated.
- Disabling a staff profile blocks API access, and password recovery uses Supabase Auth email.
- Student signup, OTP verification, login, reset, and profile flows still work using the current custom student auth.
- Request creation, owner-scoped reads, admin status updates, activity/email logs, OR upload/review/history, settings, and notifications work against the fresh schema.
- Check browser network traffic and built assets to verify no service-role key is present.

## Important Implementation Notes

The API uses a service-role Supabase client, which bypasses RLS; backend authorization remains mandatory. The `admins` profile role is authoritative, not JWT user metadata. Supabase Auth tokens are validated by the backend and mapped to an active profile before admin-only API access. Keep the student JWT path separate from Admin Auth.

Previously exposed credentials must be revoked/rotated with their providers before this project is deployed. Do not reuse the values from the former `.env` attachment.
