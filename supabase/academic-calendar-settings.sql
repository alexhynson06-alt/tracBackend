-- Add configurable calendar boundaries to Admin-managed system settings.
-- Review the live schema and rehearse against a disposable/staging database first.
-- Do not apply this file directly to production without an approved migration plan.

alter table public.system_settings
  add column if not exists activity_calendar jsonb not null default '{
    "schoolYearStartMonth": 8,
    "semesters": {
      "first": { "startMonth": 8, "endMonth": 12 },
      "second": { "startMonth": 1, "endMonth": 5 },
      "summer": { "startMonth": 6, "endMonth": 7 }
    }
  }'::jsonb;

comment on column public.system_settings.activity_calendar is
  'Admin-managed school-year start and semester month ranges used by Activity Logs.';