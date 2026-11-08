-- Add OR history identity constraints to databases where
-- or-submission-history.sql was already applied before these constraints existed.
-- NOT VALID preserves legacy rows while enforcing the constraints on new writes.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.request_or_submissions'::regclass
      AND conname = 'request_or_submissions_submitted_by_fkey'
  ) THEN
    ALTER TABLE public.request_or_submissions
      ADD CONSTRAINT request_or_submissions_submitted_by_fkey
      FOREIGN KEY (submitted_by) REFERENCES public.users(id)
      ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.request_or_submissions'::regclass
      AND conname = 'request_or_submissions_reviewed_by_fkey'
  ) THEN
    ALTER TABLE public.request_or_submissions
      ADD CONSTRAINT request_or_submissions_reviewed_by_fkey
      FOREIGN KEY (reviewed_by) REFERENCES public.admins(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END;
$$;

REVOKE ALL ON public.request_or_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.request_or_submissions TO service_role;

NOTIFY pgrst, 'reload schema';
