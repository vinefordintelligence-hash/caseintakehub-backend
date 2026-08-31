-- Phase: backend completion (SOURCE ONLY — NOT AUTOMATICALLY APPLIED)
--
-- Additive enterprise administration and financial-intelligence schema.
-- This file intentionally contains no destructive operation, existing-business-row
-- update, reseed, or protected-case reference. Review against the live
-- schema and apply with a privileged migration procedure only after approval.

BEGIN;

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.vf_identity_links (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supabase_user_id uuid NOT NULL,
  email_snapshot text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  linked_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_user_id),
  UNIQUE (supabase_user_id)
);

CREATE INDEX IF NOT EXISTS idx_vf_identity_links_org ON public.vf_identity_links (organization_id);

CREATE TABLE IF NOT EXISTS public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('super_admin', 'admin', 'investigator', 'financial_analyst', 'staff', 'client')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, app_user_id)
);

-- CREATE TABLE IF NOT EXISTS does not retrofit constraints when this table was
-- created by an earlier deployment. Keep new writes aligned with app_users.role
-- without rewriting or rejecting any pre-existing row during deployment.
DO $$ BEGIN
  ALTER TABLE public.organization_memberships
    ADD CONSTRAINT organization_memberships_role_check
    CHECK (role IN ('super_admin', 'admin', 'investigator', 'financial_analyst', 'staff', 'client')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_organization_memberships_user ON public.organization_memberships (app_user_id);

CREATE TABLE IF NOT EXISTS public.case_assignments (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  assignment_role text NOT NULL CHECK (assignment_role IN ('owner', 'investigator', 'reviewer', 'staff')),
  active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, app_user_id, assignment_role)
);

CREATE INDEX IF NOT EXISTS idx_case_assignments_case_active ON public.case_assignments (case_id, active);
CREATE INDEX IF NOT EXISTS idx_case_assignments_org_user ON public.case_assignments (organization_id, app_user_id);

CREATE TABLE IF NOT EXISTS public.organization_settings (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  setting_key text NOT NULL,
  setting_value jsonb NOT NULL,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, setting_key)
);

CREATE TABLE IF NOT EXISTS public.case_assets (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  asset_type text NOT NULL,
  label text NOT NULL,
  description text,
  currency text,
  estimated_value numeric(20, 8),
  verified_value numeric(20, 8),
  status text NOT NULL DEFAULT 'identified',
  source text,
  linked_evidence_id uuid,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_assets_org_case ON public.case_assets (organization_id, case_id);

CREATE TABLE IF NOT EXISTS public.case_wallets (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  network text NOT NULL,
  address text NOT NULL,
  label text,
  classification text,
  notes text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, network, address)
);

CREATE INDEX IF NOT EXISTS idx_case_wallets_org_case ON public.case_wallets (organization_id, case_id);

CREATE TABLE IF NOT EXISTS public.case_transactions (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  network text NOT NULL,
  transaction_hash text NOT NULL,
  asset_token text,
  amount numeric(20, 8),
  currency text,
  source_address text,
  destination_address text,
  transaction_timestamp timestamptz,
  block_number bigint,
  status text,
  classification text,
  linked_evidence_id uuid,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, network, transaction_hash)
);

CREATE INDEX IF NOT EXISTS idx_case_transactions_org_case ON public.case_transactions (organization_id, case_id);

CREATE TABLE IF NOT EXISTS public.case_intelligence_traces (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  relationship_type text NOT NULL,
  classification text,
  source_note text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, source_type, source_id, target_type, target_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_case_intelligence_traces_org_case ON public.case_intelligence_traces (organization_id, case_id);

CREATE TABLE IF NOT EXISTS public.case_recoveries (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.case_assets(id) ON DELETE SET NULL,
  transaction_id uuid REFERENCES public.case_transactions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'identified' CHECK (status IN ('identified', 'tracing', 'frozen', 'recovery_pending', 'partially_recovered', 'recovered', 'returned', 'closed')),
  amount numeric(20, 8),
  currency text,
  recovered_amount numeric(20, 8) NOT NULL DEFAULT 0,
  returned_amount numeric(20, 8) NOT NULL DEFAULT 0,
  note text,
  linked_evidence_id uuid,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_recoveries_org_case ON public.case_recoveries (organization_id, case_id);

CREATE TABLE IF NOT EXISTS public.case_recovery_events (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  recovery_id uuid NOT NULL REFERENCES public.case_recoveries(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  prior_state jsonb,
  next_state jsonb NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_recovery_events_recovery ON public.case_recovery_events (recovery_id, created_at);

CREATE TABLE IF NOT EXISTS public.case_assignment_transfers (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  source_assignment_id uuid REFERENCES public.case_assignments(id) ON DELETE SET NULL,
  destination_app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  destination_role text NOT NULL CHECK (destination_role IN ('owner', 'investigator', 'reviewer', 'staff')),
  requested_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'completed', 'rejected', 'cancelled')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_assignment_transfers_org_case ON public.case_assignment_transfers (organization_id, case_id, status);

CREATE TABLE IF NOT EXISTS public.treasury_accounts (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  account_reference text NOT NULL,
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, account_reference, currency)
);
CREATE INDEX IF NOT EXISTS idx_treasury_accounts_org_case ON public.treasury_accounts (organization_id, case_id);

CREATE TABLE IF NOT EXISTS public.treasury_ledger_entries (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  treasury_account_id uuid NOT NULL REFERENCES public.treasury_accounts(id) ON DELETE RESTRICT,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('credit', 'debit', 'allocation', 'release', 'adjustment', 'reversal')),
  amount numeric(20, 8) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  reference text,
  source_type text,
  source_id uuid,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversal_of uuid REFERENCES public.treasury_ledger_entries(id) ON DELETE RESTRICT,
  UNIQUE (treasury_account_id, reference)
);
CREATE INDEX IF NOT EXISTS idx_treasury_ledger_org_account ON public.treasury_ledger_entries (organization_id, treasury_account_id, created_at);

CREATE TABLE IF NOT EXISTS public.treasury_funding_allocations (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  treasury_account_id uuid NOT NULL REFERENCES public.treasury_accounts(id) ON DELETE RESTRICT,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  amount numeric(20, 8) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  funding_reference text NOT NULL,
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'cancelled')),
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, funding_reference)
);
CREATE INDEX IF NOT EXISTS idx_treasury_funding_org_case ON public.treasury_funding_allocations (organization_id, case_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.vf_reject_treasury_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'treasury ledger entries are immutable; create a reversal entry instead';
END;
$$;
CREATE OR REPLACE TRIGGER trg_treasury_ledger_immutable
BEFORE UPDATE OR DELETE ON public.treasury_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.vf_reject_treasury_ledger_mutation();

-- Existing supported payment, transfer, and withdrawal tables already expose
-- a currency field in the source entities. No legacy amount is rewritten.
COMMIT;
