BEGIN;

-- Server-persisted 2-minute fee-availability window. The new columns are
-- additive and nullable; no existing historical data is rewritten.
ALTER TABLE public.transaction_authorization_reviews
  ADD COLUMN IF NOT EXISTS document_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_payment_available_at timestamptz;

-- A verified document always carries a payment-availability window, and a
-- payment window is only ever granted to an administrator-verified document.
ALTER TABLE public.transaction_authorization_reviews
  ADD CONSTRAINT tar_document_verified_requires_window
  CHECK ((document_verified_at IS NULL) OR (next_payment_available_at IS NOT NULL));

ALTER TABLE public.transaction_authorization_reviews
  ADD CONSTRAINT tar_payment_window_verified_only
  CHECK ((next_payment_available_at IS NULL) OR (document_status = 'VERIFIED'));

COMMIT;