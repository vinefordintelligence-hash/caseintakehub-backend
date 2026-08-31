BEGIN;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS proof_document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_payments_proof_document ON public.payments(proof_document_id)
  WHERE proof_document_id IS NOT NULL;

COMMIT;
