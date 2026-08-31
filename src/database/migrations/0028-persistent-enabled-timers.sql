BEGIN;

ALTER TABLE public.case_payments
  ADD COLUMN IF NOT EXISTS enabled_at timestamptz;

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS enabled_at timestamptz;

-- Legacy enabled periods already have authoritative server-written timestamps.
-- Initialize only the affected enabled rows; disabled records remain NULL.
UPDATE public.case_payments
SET enabled_at=created_at
WHERE gate_enabled=true AND enabled_at IS NULL;

UPDATE public.organization_settings
SET enabled_at=updated_at
WHERE setting_key='features.walletConnectionsEnabled'
  AND setting_value::text IN ('true','"true"')
  AND enabled_at IS NULL;

COMMIT;
