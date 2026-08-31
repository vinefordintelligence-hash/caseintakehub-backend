BEGIN;

-- A review may concern a transaction that is not yet an executable transfer.
-- Keep its authorized receiving details in the protected, organization-scoped
-- review row instead of fabricating or modifying a case transfer.
ALTER TABLE public.transaction_authorization_reviews
  ADD COLUMN IF NOT EXISTS transaction_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS transaction_currency text,
  ADD COLUMN IF NOT EXISTS transaction_reference text,
  ADD COLUMN IF NOT EXISTS receiving_account_holder text,
  ADD COLUMN IF NOT EXISTS receiving_bank_name text,
  ADD COLUMN IF NOT EXISTS receiving_account_type text,
  ADD COLUMN IF NOT EXISTS receiving_account_number text,
  ADD COLUMN IF NOT EXISTS receiving_routing_number text,
  ADD COLUMN IF NOT EXISTS receiving_bank_verified boolean;

ALTER TABLE public.transaction_authorization_reviews
  DROP CONSTRAINT IF EXISTS tar_transaction_currency_check;

ALTER TABLE public.transaction_authorization_reviews
  ADD CONSTRAINT tar_transaction_currency_check
  CHECK (transaction_currency IS NULL OR transaction_currency ~ '^[A-Z]{3}$');

COMMIT;
