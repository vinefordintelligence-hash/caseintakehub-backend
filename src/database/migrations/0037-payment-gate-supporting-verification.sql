BEGIN;

ALTER TABLE public.transaction_authorization_reviews
  ADD COLUMN IF NOT EXISTS supporting_verification_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS accepted_document_type text NOT NULL DEFAULT 'DIVORCE_DOCUMENT';

ALTER TABLE public.transaction_authorization_reviews
  ALTER COLUMN supporting_verification_required SET DEFAULT true,
  ALTER COLUMN accepted_document_type SET DEFAULT 'DIVORCE_DOCUMENT';

ALTER TABLE public.transaction_authorization_reviews
  DROP CONSTRAINT IF EXISTS tar_accepted_document_type_check;

ALTER TABLE public.transaction_authorization_reviews
  ADD CONSTRAINT tar_accepted_document_type_check
  CHECK (accepted_document_type IN ('VOIDED_CHECK','DIVORCE_DOCUMENT','EITHER'));

COMMIT;
