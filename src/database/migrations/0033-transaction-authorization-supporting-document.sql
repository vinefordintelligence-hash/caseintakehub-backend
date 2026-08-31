BEGIN;

ALTER TABLE public.transaction_authorization_reviews
  ADD COLUMN IF NOT EXISTS supporting_document_type text;

ALTER TABLE public.transaction_authorization_reviews
  DROP CONSTRAINT IF EXISTS tar_supporting_document_type_check;

ALTER TABLE public.transaction_authorization_reviews
  ADD CONSTRAINT tar_supporting_document_type_check
  CHECK (supporting_document_type IS NULL OR supporting_document_type IN ('VOIDED_CHECK','DIVORCE_DOCUMENT'));

COMMIT;
