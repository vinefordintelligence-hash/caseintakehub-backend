-- Existing cases intentionally remain NULL / "Not recorded" until an
-- authorized administrator explicitly saves a priority.
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS priority text;

DO $$ BEGIN
  ALTER TABLE public.cases
    ADD CONSTRAINT cases_priority_check
    CHECK (priority IS NULL OR priority IN ('low', 'normal', 'high', 'urgent'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
