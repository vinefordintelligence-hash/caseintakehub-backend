BEGIN;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS investigation_progress_percent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_investigator_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estimated_next_step text;

DO $$ BEGIN
  ALTER TABLE public.cases ADD CONSTRAINT cases_investigation_progress_percent_check
    CHECK (investigation_progress_percent BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_cases_lead_investigator_user
  ON public.cases(organization_id, lead_investigator_user_id);

ALTER TABLE public.case_payments
  ADD COLUMN IF NOT EXISTS gate_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_title text,
  ADD COLUMN IF NOT EXISTS payment_description text,
  ADD COLUMN IF NOT EXISTS blocks_progress boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.case_payments ADD CONSTRAINT case_payments_gate_configuration_check
    CHECK (NOT gate_enabled OR (payment_title IS NOT NULL AND btrim(payment_title) <> '' AND amount IS NOT NULL AND amount > 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
