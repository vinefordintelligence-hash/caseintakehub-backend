BEGIN;

ALTER TABLE public.evidence
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS custody_status text,
  ADD COLUMN IF NOT EXISTS integrity_status text;

DO $$ BEGIN
  ALTER TABLE public.evidence ADD CONSTRAINT evidence_review_status_check
    CHECK (review_status IN ('pending','in_review','approved','rejected','needs_information','manual_review'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_note text,
  ADD COLUMN IF NOT EXISTS proof_reference text;

DO $$ BEGIN
  ALTER TABLE public.payments ADD CONSTRAINT payments_verification_status_check
    CHECK (verification_status IN ('pending','in_review','verified','rejected','needs_information','manual_review'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_evidence_review_queue ON public.evidence(organization_id,review_status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_verification_queue ON public.payments(organization_id,verification_status,created_at DESC);

COMMIT;
