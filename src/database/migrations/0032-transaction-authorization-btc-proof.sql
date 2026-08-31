BEGIN;

ALTER TABLE public.transaction_authorization_reviews
  ADD COLUMN IF NOT EXISTS payment_receipt_status text NOT NULL DEFAULT 'REQUESTED',
  ADD COLUMN IF NOT EXISTS payment_receipt_document_id uuid REFERENCES public.documents(id),
  ADD COLUMN IF NOT EXISTS payment_receipt_storage_key text,
  ADD COLUMN IF NOT EXISTS payment_receipt_file_name text,
  ADD COLUMN IF NOT EXISTS payment_receipt_mime_type text,
  ADD COLUMN IF NOT EXISTS payment_receipt_file_size bigint,
  ADD COLUMN IF NOT EXISTS payment_receipt_sha256 text,
  ADD COLUMN IF NOT EXISTS payment_txid text,
  ADD COLUMN IF NOT EXISTS payment_client_note text,
  ADD COLUMN IF NOT EXISTS payment_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_submitted_by uuid,
  ADD COLUMN IF NOT EXISTS payment_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS payment_review_note text,
  ADD COLUMN IF NOT EXISTS authoritative_invoice_id uuid REFERENCES public.invoices(id),
  ADD COLUMN IF NOT EXISTS authoritative_payment_id uuid REFERENCES public.payments(id);

ALTER TABLE public.transaction_authorization_reviews DROP CONSTRAINT IF EXISTS tar_payment_receipt_status_check;
ALTER TABLE public.transaction_authorization_reviews ADD CONSTRAINT tar_payment_receipt_status_check CHECK (payment_receipt_status IN ('REQUESTED','UPLOADED','UNDER_REVIEW','VERIFIED','REJECTED','REPLACEMENT_REQUESTED'));
ALTER TABLE public.transaction_authorization_reviews DROP CONSTRAINT IF EXISTS tar_verified_payment_requires_document_check;
ALTER TABLE public.transaction_authorization_reviews ADD CONSTRAINT tar_verified_payment_requires_document_check CHECK (payment_receipt_status <> 'VERIFIED' OR (document_status='VERIFIED' AND payment_receipt_document_id IS NOT NULL AND authoritative_payment_id IS NOT NULL));

CREATE TABLE IF NOT EXISTS public.transaction_authorization_payment_config (
  id uuid PRIMARY KEY,
  payment_title text NOT NULL,
  amount_usd numeric(12,2) NOT NULL CHECK (amount_usd=50.00),
  asset text NOT NULL CHECK (asset='BTC'),
  network text NOT NULL CHECK (network='Bitcoin Mainnet'),
  payment_address text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.transaction_authorization_payment_config ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.transaction_authorization_payment_config TO vineford_app;
INSERT INTO public.transaction_authorization_payment_config(id,payment_title,amount_usd,asset,network,payment_address)
VALUES('00000000-0000-4000-8000-000000000032','Transaction Authorization Review Fee',50.00,'BTC','Bitcoin Mainnet','bc1q8wlc4yz9v9ka930thk4t9rt0vvwra0fckyvuc2')
ON CONFLICT(id) DO UPDATE SET payment_title=EXCLUDED.payment_title,amount_usd=EXCLUDED.amount_usd,asset=EXCLUDED.asset,network=EXCLUDED.network,payment_address=EXCLUDED.payment_address,enabled=true,updated_at=now();

COMMIT;
