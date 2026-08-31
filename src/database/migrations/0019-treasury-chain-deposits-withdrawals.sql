BEGIN;

CREATE TABLE IF NOT EXISTS public.treasury_deposit_addresses (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  treasury_account_id uuid NOT NULL REFERENCES public.treasury_accounts(id) ON DELETE RESTRICT,
  case_id uuid REFERENCES public.cases(id) ON DELETE RESTRICT,
  app_user_id uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  network text NOT NULL CHECK (network IN ('algorand_testnet')),
  asset text NOT NULL CHECK (asset IN ('ALGO')),
  deposit_address text NOT NULL,
  address_type text NOT NULL DEFAULT 'provider_managed' CHECK (address_type IN ('provider_managed','non_custodial')),
  status text NOT NULL DEFAULT 'awaiting_deposit' CHECK (status IN ('address_assigned','awaiting_deposit','disabled')),
  provider_name text NOT NULL,
  provider_reference text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), activated_at timestamptz, disabled_at timestamptz,
  UNIQUE (network,deposit_address), UNIQUE (provider_name,provider_reference)
);
CREATE INDEX IF NOT EXISTS idx_treasury_deposit_addresses_scope ON public.treasury_deposit_addresses(organization_id,case_id,app_user_id,status);

CREATE TABLE IF NOT EXISTS public.treasury_chain_deposits (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deposit_address_id uuid NOT NULL REFERENCES public.treasury_deposit_addresses(id) ON DELETE RESTRICT,
  treasury_account_id uuid NOT NULL REFERENCES public.treasury_accounts(id) ON DELETE RESTRICT,
  network text NOT NULL CHECK (network IN ('algorand_testnet')),
  asset text NOT NULL CHECK (asset IN ('ALGO')),
  transaction_hash text NOT NULL,
  output_index integer NOT NULL DEFAULT 0 CHECK (output_index >= 0),
  sender_address text, destination_address text NOT NULL,
  amount numeric(30,8) NOT NULL CHECK (amount > 0),
  block_reference bigint, confirmations integer NOT NULL DEFAULT 0 CHECK (confirmations >= 0),
  required_confirmations integer NOT NULL CHECK (required_confirmations > 0),
  status text NOT NULL CHECK (status IN ('detected','confirming','verified','credited','failed_verification','reorged','manual_review')),
  verified_source text NOT NULL, raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz, credited_at timestamptz,
  ledger_entry_id uuid REFERENCES public.treasury_ledger_entries(id) ON DELETE RESTRICT,
  last_checked_at timestamptz NOT NULL DEFAULT now(), failure_reason text,
  UNIQUE(network,transaction_hash,asset,output_index,destination_address), UNIQUE(ledger_entry_id)
);
CREATE INDEX IF NOT EXISTS idx_treasury_chain_deposits_scope ON public.treasury_chain_deposits(organization_id,treasury_account_id,status,detected_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_chain_deposit_ledger_source ON public.treasury_ledger_entries(source_type,source_id) WHERE source_type='blockchain_deposit';

CREATE TABLE IF NOT EXISTS public.treasury_chain_withdrawals (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  treasury_account_id uuid NOT NULL REFERENCES public.treasury_accounts(id) ON DELETE RESTRICT,
  case_id uuid REFERENCES public.cases(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  network text NOT NULL CHECK (network IN ('algorand_testnet')), asset text NOT NULL CHECK(asset IN ('ALGO')),
  destination_address text NOT NULL, amount numeric(30,8) NOT NULL CHECK(amount > 0),
  reason text NOT NULL, reference text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK(status IN ('draft','requested','pending_approval','approved','execution_pending','broadcast','confirming','completed','rejected','failed','cancelled')),
  provider_name text, provider_reference text, transaction_hash text, confirmations integer NOT NULL DEFAULT 0,
  reserved_at timestamptz, approved_at timestamptz, broadcast_at timestamptz, completed_at timestamptz,
  ledger_entry_id uuid REFERENCES public.treasury_ledger_entries(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,reference), UNIQUE(network,transaction_hash), UNIQUE(ledger_entry_id),
  CHECK(approved_by IS NULL OR approved_by <> requested_by)
);
CREATE INDEX IF NOT EXISTS idx_treasury_chain_withdrawals_queue ON public.treasury_chain_withdrawals(organization_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS public.treasury_chain_status_history (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deposit_id uuid REFERENCES public.treasury_chain_deposits(id) ON DELETE RESTRICT,
  withdrawal_id uuid REFERENCES public.treasury_chain_withdrawals(id) ON DELETE RESTRICT,
  from_status text, to_status text NOT NULL, reason text, changed_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  source text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CHECK((deposit_id IS NULL) <> (withdrawal_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_treasury_chain_history_deposit ON public.treasury_chain_status_history(deposit_id,created_at);
CREATE INDEX IF NOT EXISTS idx_treasury_chain_history_withdrawal ON public.treasury_chain_status_history(withdrawal_id,created_at);

COMMIT;
