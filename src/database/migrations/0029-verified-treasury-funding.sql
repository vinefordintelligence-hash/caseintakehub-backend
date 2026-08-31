-- 0029 — Verified Treasury funding ledger (additive, production-safe)
-- Existing Treasury, payment, transfer and case rows are never rewritten.
BEGIN;

ALTER TABLE public.treasury_funding_allocations
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS funding_type text,
  ADD COLUMN IF NOT EXISTS funding_effect text NOT NULL DEFAULT 'credit',
  ADD COLUMN IF NOT EXISTS external_reference text,
  ADD COLUMN IF NOT EXISTS funding_date timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS supporting_document_id uuid,
  ADD COLUMN IF NOT EXISTS supporting_evidence_id uuid,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.treasury_funding_allocations ALTER COLUMN status SET DEFAULT 'pending';
DO $constraints$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name FROM pg_constraint
   WHERE conrelid='public.treasury_funding_allocations'::regclass AND contype='c'
     AND pg_get_constraintdef(oid) LIKE '%status%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.treasury_funding_allocations DROP CONSTRAINT %I',constraint_name);
  END IF;
END $constraints$;
ALTER TABLE public.treasury_funding_allocations
  ADD CONSTRAINT treasury_funding_status_check CHECK(status IN ('recorded','pending','under_review','verified','rejected','cancelled')),
  ADD CONSTRAINT treasury_funding_type_check CHECK(funding_type IS NULL OR funding_type IN ('client_deposit','organization_allocation','verified_external_transfer','bank_wire','crypto_funding','adjustment_correction')),
  ADD CONSTRAINT treasury_funding_effect_check CHECK(funding_effect IN ('credit','debit')),
  ADD CONSTRAINT treasury_funding_adjustment_effect_check CHECK(funding_effect='credit' OR funding_type='adjustment_correction'),
  ADD CONSTRAINT treasury_funding_support_check CHECK(NOT (supporting_document_id IS NOT NULL AND supporting_evidence_id IS NOT NULL)),
  ADD CONSTRAINT treasury_funding_client_fkey FOREIGN KEY(client_id) REFERENCES public.clients(id) ON DELETE RESTRICT,
  ADD CONSTRAINT treasury_funding_submitted_by_fkey FOREIGN KEY(submitted_by) REFERENCES public.app_users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT treasury_funding_verified_by_fkey FOREIGN KEY(verified_by) REFERENCES public.app_users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT treasury_funding_document_fkey FOREIGN KEY(supporting_document_id) REFERENCES public.documents(id) ON DELETE RESTRICT,
  ADD CONSTRAINT treasury_funding_evidence_fkey FOREIGN KEY(supporting_evidence_id) REFERENCES public.evidence(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_treasury_funding_review_queue ON public.treasury_funding_allocations(organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_treasury_funding_client_case ON public.treasury_funding_allocations(organization_id,client_id,case_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.treasury_funding_status_history (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  funding_id uuid NOT NULL REFERENCES public.treasury_funding_allocations(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  reason text,
  changed_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_treasury_funding_history ON public.treasury_funding_status_history(organization_id,funding_id,created_at);

ALTER TABLE public.treasury_chain_withdrawals
  ADD COLUMN IF NOT EXISTS verification_blockers jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $withdrawal_constraint$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name FROM pg_constraint
   WHERE conrelid='public.treasury_chain_withdrawals'::regclass AND contype='c'
     AND pg_get_constraintdef(oid) LIKE '%pending_approval%';
  IF constraint_name IS NOT NULL THEN EXECUTE format('ALTER TABLE public.treasury_chain_withdrawals DROP CONSTRAINT %I',constraint_name); END IF;
END $withdrawal_constraint$;
ALTER TABLE public.treasury_chain_withdrawals ADD CONSTRAINT treasury_chain_withdrawals_status_check
  CHECK(status IN ('draft','requested','verification_required','pending_approval','approved','execution_pending','broadcast','confirming','completed','rejected','failed','cancelled'));

-- The trusted API role is the only application database principal. Request
-- identity and tenant scope are verified by the API before every query; forced
-- RLS prevents access by any other database role.
DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['treasury_accounts','treasury_ledger_entries','treasury_funding_allocations','treasury_funding_status_history','treasury_deposit_addresses','treasury_chain_deposits','treasury_chain_withdrawals','treasury_chain_status_history'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name AND policyname='vineford_backend_select') THEN
      EXECUTE format('CREATE POLICY vineford_backend_select ON public.%I FOR SELECT TO vineford_app USING (true)',table_name);
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name AND policyname='vineford_backend_insert') THEN
      EXECUTE format('CREATE POLICY vineford_backend_insert ON public.%I FOR INSERT TO vineford_app WITH CHECK (true)',table_name);
    END IF;
    IF table_name <> 'treasury_ledger_entries' AND NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name AND policyname='vineford_backend_update') THEN
      EXECUTE format('CREATE POLICY vineford_backend_update ON public.%I FOR UPDATE TO vineford_app USING (true) WITH CHECK (true)',table_name);
    END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',table_name);
  END LOOP;
END $rls$;

GRANT SELECT,INSERT ON public.treasury_ledger_entries,public.treasury_funding_status_history TO vineford_app;
GRANT SELECT,INSERT,UPDATE ON public.treasury_accounts,public.treasury_funding_allocations,public.treasury_deposit_addresses,public.treasury_chain_deposits,public.treasury_chain_withdrawals,public.treasury_chain_status_history TO vineford_app;
COMMIT;
