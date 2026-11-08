-- Optional rollback for academic-calendar-settings.sql.
-- First export and retain public.system_settings.activity_calendar values.
-- Dropping this column removes all saved calendar configuration.
-- Review and test against the target schema before use; never run blindly in production.

alter table public.system_settings
  drop column if exists activity_calendar;