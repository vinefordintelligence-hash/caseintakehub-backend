BEGIN;

CREATE TABLE IF NOT EXISTS public.transaction_authorization_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  case_id uuid NOT NULL REFERENCES public.cases(id),
  transfer_id uuid REFERENCES public.case_transfers(id),
  status text NOT NULL DEFAULT 'PENDING_DOCUMENTATION' CHECK (status IN ('PENDING_DOCUMENTATION','DOCUMENT_UNDER_REVIEW','DOCUMENT_VERIFIED','FEE_REQUIRED','FEE_PAID','UNDER_AUTHORIZATION_REVIEW','APPROVED','REJECTED','CANCELLED')),
  document_status text NOT NULL DEFAULT 'REQUESTED' CHECK (document_status IN ('REQUESTED','UPLOADED','UNDER_REVIEW','VERIFIED','REJECTED','REPLACEMENT_REQUESTED')),
  current_document_id uuid REFERENCES public.documents(id),
  storage_key text,
  original_file_name text,
  mime_type text,
  file_size bigint,
  file_sha256 text,
  submitted_at timestamptz,
  submitted_by uuid,
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text,
  fee_activated_at timestamptz,
  authorization_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id),
  CHECK ((document_status = 'REQUESTED') OR current_document_id IS NOT NULL),
  CHECK ((fee_activated_at IS NULL) OR document_status = 'VERIFIED')
);
CREATE INDEX IF NOT EXISTS idx_tar_org_case ON public.transaction_authorization_reviews(organization_id,case_id);
ALTER TABLE public.transaction_authorization_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tar_organization_scope ON public.transaction_authorization_reviews;
CREATE POLICY tar_organization_scope ON public.transaction_authorization_reviews USING (organization_id = nullif(current_setting('app.current_organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON public.transaction_authorization_reviews TO vineford_app;

-- Review rows are provisioned only by an authorized case operation. This migration
-- deliberately does not seed any case, transaction, document, fee, or activity.
COMMIT;
