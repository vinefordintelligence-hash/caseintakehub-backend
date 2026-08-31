-- Phase K extension: Vineford Funding & Escrow (SOURCE ONLY — DO NOT AUTO-APPLY)
-- Additive schema. No legacy rows are rewritten and no case is targeted.

BEGIN;

CREATE TABLE IF NOT EXISTS public.funding_programs (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  treasury_account_id uuid REFERENCES public.treasury_accounts(id) ON DELETE RESTRICT,
  chain_network text CHECK (chain_network IS NULL OR chain_network = 'algorand_testnet'),
  chain_application_id bigint CHECK (chain_application_id IS NULL OR chain_application_id > 0),
  chain_escrow_address text,
  reference_number text NOT NULL,
  title text NOT NULL,
  description text,
  funding_purpose text,
  funding_source text,
  category text,
  funding_mode text NOT NULL CHECK (funding_mode IN ('managed', 'on_chain')),
  currency text NOT NULL,
  total_amount numeric(20,8) NOT NULL CHECK (total_amount > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','active','paused','completed','cancelled')),
  application_mode text NOT NULL DEFAULT 'assigned' CHECK (application_mode IN ('assigned','open')),
  approval_threshold numeric(5,2) NOT NULL DEFAULT 50 CHECK (approval_threshold > 0 AND approval_threshold <= 100),
  minimum_approval_count integer NOT NULL DEFAULT 1 CHECK (minimum_approval_count > 0),
  challenge_period interval NOT NULL DEFAULT interval '0 days' CHECK (challenge_period >= interval '0 days'),
  eligibility_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  start_date date,
  end_date date,
  responsible_administrator_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,reference_number),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_funding_programs_org_status ON public.funding_programs (organization_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS public.funding_program_reviewers (
  program_id uuid NOT NULL REFERENCES public.funding_programs(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (program_id,reviewer_id)
);

CREATE TABLE IF NOT EXISTS public.funding_recipients (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.funding_programs(id) ON DELETE CASCADE,
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected','expired')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','completed','ineligible')),
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_destination jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id,app_user_id)
);
CREATE INDEX IF NOT EXISTS idx_funding_recipients_org_user ON public.funding_recipients (organization_id,app_user_id);

CREATE TABLE IF NOT EXISTS public.funding_applications (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.funding_programs(id) ON DELETE CASCADE,
  applicant_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  requested_amount numeric(20,8) NOT NULL CHECK (requested_amount > 0),
  currency text NOT NULL,
  statement text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','under_review','additional_information_required','approved','partially_approved','rejected','withdrawn','funded','completed')),
  approved_amount numeric(20,8) CHECK (approved_amount IS NULL OR approved_amount > 0),
  reviewed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id,applicant_id)
);
CREATE INDEX IF NOT EXISTS idx_funding_applications_org_status ON public.funding_applications (organization_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS public.funding_application_status_history (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.funding_applications(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  changed_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_funding_application_history ON public.funding_application_status_history (organization_id,application_id,created_at);

CREATE TABLE IF NOT EXISTS public.funding_milestones (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.funding_programs(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES public.funding_recipients(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  sequence integer NOT NULL CHECK (sequence > 0),
  allocated_amount numeric(20,8) NOT NULL CHECK (allocated_amount > 0),
  currency text NOT NULL,
  deadline timestamptz,
  approval_threshold numeric(5,2) NOT NULL CHECK (approval_threshold > 0 AND approval_threshold <= 100),
  minimum_approval_count integer NOT NULL DEFAULT 1 CHECK (minimum_approval_count > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','submitted','under_review','approved','rejected','challenged','release_pending','released','closed')),
  challenge_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id,sequence)
);
CREATE INDEX IF NOT EXISTS idx_funding_milestones_org_program ON public.funding_milestones (organization_id,program_id,sequence);

CREATE TABLE IF NOT EXISTS public.funding_milestone_reviewers (
  milestone_id uuid NOT NULL REFERENCES public.funding_milestones(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (milestone_id,reviewer_id)
);

CREATE TABLE IF NOT EXISTS public.funding_milestone_status_history (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  milestone_id uuid NOT NULL REFERENCES public.funding_milestones(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  changed_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.funding_milestone_submissions (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.funding_programs(id) ON DELETE CASCADE,
  milestone_id uuid NOT NULL REFERENCES public.funding_milestones(id) ON DELETE CASCADE,
  submitter_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  description text NOT NULL,
  external_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  github_repository text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','superseded','accepted','rejected')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (milestone_id,version)
);
CREATE INDEX IF NOT EXISTS idx_funding_submissions_milestone ON public.funding_milestone_submissions (organization_id,milestone_id,version DESC);

CREATE TABLE IF NOT EXISTS public.funding_submission_evidence (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  submission_id uuid NOT NULL REFERENCES public.funding_milestone_submissions(id) ON DELETE CASCADE,
  evidence_id uuid REFERENCES public.evidence(id) ON DELETE RESTRICT,
  document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((evidence_id IS NOT NULL)::integer + (document_id IS NOT NULL)::integer = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_submission_evidence
  ON public.funding_submission_evidence (submission_id,evidence_id) WHERE evidence_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_submission_documents
  ON public.funding_submission_evidence (submission_id,document_id) WHERE document_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.funding_supporting_documents (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id uuid REFERENCES public.funding_programs(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES public.funding_recipients(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.funding_applications(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT,
  evidence_id uuid REFERENCES public.evidence(id) ON DELETE RESTRICT,
  linked_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((document_id IS NOT NULL)::integer + (evidence_id IS NOT NULL)::integer = 1),
  CHECK ((program_id IS NOT NULL)::integer + (recipient_id IS NOT NULL)::integer + (application_id IS NOT NULL)::integer = 1)
);

CREATE TABLE IF NOT EXISTS public.funding_reviews (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  milestone_id uuid NOT NULL REFERENCES public.funding_milestones(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL REFERENCES public.funding_milestone_submissions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','threshold_reached','rejected','challenged','closed')),
  opened_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (submission_id)
);
CREATE INDEX IF NOT EXISTS idx_funding_reviews_org_status ON public.funding_reviews (organization_id,status,opened_at DESC);

CREATE TABLE IF NOT EXISTS public.funding_review_actions (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  review_id uuid NOT NULL REFERENCES public.funding_reviews(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('note','request_additional_evidence','approve','reject','flag_discrepancy')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.funding_votes (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  review_id uuid NOT NULL REFERENCES public.funding_reviews(id) ON DELETE CASCADE,
  milestone_id uuid NOT NULL REFERENCES public.funding_milestones(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approve','reject')),
  reason text,
  weight numeric(12,4) NOT NULL DEFAULT 1 CHECK (weight = 1),
  source text NOT NULL DEFAULT 'vineford' CHECK (source IN ('vineford','algorand')),
  on_chain_transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id,reviewer_id)
);
CREATE INDEX IF NOT EXISTS idx_funding_votes_review ON public.funding_votes (organization_id,review_id,created_at);

CREATE TABLE IF NOT EXISTS public.funding_allocations (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.funding_programs(id) ON DELETE RESTRICT,
  milestone_id uuid REFERENCES public.funding_milestones(id) ON DELETE RESTRICT,
  treasury_account_id uuid REFERENCES public.treasury_accounts(id) ON DELETE RESTRICT,
  chain_transaction_id uuid,
  amount numeric(20,8) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'committed' CHECK (status IN ('committed','release_pending','released','cancelled')),
  created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id,milestone_id)
);
CREATE INDEX IF NOT EXISTS idx_funding_allocations_org_program ON public.funding_allocations (organization_id,program_id,status);

CREATE TABLE IF NOT EXISTS public.funding_disputes (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.funding_programs(id) ON DELETE CASCADE,
  milestone_id uuid NOT NULL REFERENCES public.funding_milestones(id) ON DELETE CASCADE,
  raised_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','upheld','dismissed','resolved')),
  resolution text,
  resolved_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_funding_disputes_org_status ON public.funding_disputes (organization_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS public.funding_releases (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.funding_programs(id) ON DELETE RESTRICT,
  milestone_id uuid NOT NULL REFERENCES public.funding_milestones(id) ON DELETE RESTRICT,
  allocation_id uuid NOT NULL REFERENCES public.funding_allocations(id) ON DELETE RESTRICT,
  funding_mode text NOT NULL CHECK (funding_mode IN ('managed','on_chain')),
  amount numeric(20,8) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'allocation_approved' CHECK (status IN ('allocation_approved','release_requested','compliance_review','release_authorized','pending_disbursement','disbursed','failed','reversed','cancelled')),
  authorized_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  treasury_ledger_entry_id uuid REFERENCES public.treasury_ledger_entries(id) ON DELETE RESTRICT,
  chain_transaction_id uuid,
  failure_reason text,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  UNIQUE (milestone_id)
);
CREATE INDEX IF NOT EXISTS idx_funding_releases_org_status ON public.funding_releases (organization_id,status,authorized_at DESC);

CREATE TABLE IF NOT EXISTS public.funding_release_status_history (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  release_id uuid NOT NULL REFERENCES public.funding_releases(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  changed_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.funding_dispute_status_history (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dispute_id uuid NOT NULL REFERENCES public.funding_disputes(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  changed_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.funding_wallet_links (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  network text NOT NULL CHECK (network IN ('algorand_testnet')),
  address text NOT NULL,
  verification_challenge text NOT NULL,
  challenge_expires_at timestamptz NOT NULL,
  challenge_consumed_at timestamptz,
  verified_at timestamptz,
  verification_method text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network,address),
  UNIQUE (app_user_id,network)
);

CREATE TABLE IF NOT EXISTS public.funding_chain_transactions (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.funding_programs(id) ON DELETE RESTRICT,
  milestone_id uuid REFERENCES public.funding_milestones(id) ON DELETE RESTRICT,
  network text NOT NULL CHECK (network IN ('algorand_testnet')),
  transaction_hash text NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('create_grant','fund_grant','submit_milestone_reference','vote','release_funds','challenge','pause')),
  asset_id text,
  amount numeric(20,8),
  sender_address text,
  receiver_address text,
  confirmed_round bigint,
  verified_source text NOT NULL,
  raw_payload jsonb NOT NULL,
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network,transaction_hash),
  CHECK (confirmed_round IS NOT NULL AND confirmed_round > 0)
);
CREATE INDEX IF NOT EXISTS idx_funding_chain_tx_org_program ON public.funding_chain_transactions (organization_id,program_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.funding_notifications (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id uuid REFERENCES public.funding_programs(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES public.funding_milestones(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES public.app_users(id) ON DELETE CASCADE,
  recipient_role text,
  event_type text NOT NULL CHECK (event_type IN
    ('application_submitted','application_approved','application_rejected','milestone_deadline','milestone_submitted','evidence_requested','evidence_received',
     'review_required','vote_cast','threshold_reached','dispute_raised','dispute_resolved','release_authorized',
     'funds_released','disbursement_completed','release_failed','wallet_verified','chain_transaction_verified')),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (recipient_id IS NOT NULL OR recipient_role IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_funding_notifications_recipient
  ON public.funding_notifications (organization_id,recipient_id,is_read,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_funding_notifications_role
  ON public.funding_notifications (organization_id,recipient_role,is_read,created_at DESC);

ALTER TABLE public.funding_votes
  ADD CONSTRAINT funding_votes_chain_transaction_fkey
  FOREIGN KEY (on_chain_transaction_id) REFERENCES public.funding_chain_transactions(id) ON DELETE RESTRICT;
ALTER TABLE public.funding_releases
  ADD CONSTRAINT funding_releases_chain_transaction_fkey
  FOREIGN KEY (chain_transaction_id) REFERENCES public.funding_chain_transactions(id) ON DELETE RESTRICT;
ALTER TABLE public.funding_allocations
  ADD CONSTRAINT funding_allocations_chain_transaction_fkey
  FOREIGN KEY (chain_transaction_id) REFERENCES public.funding_chain_transactions(id) ON DELETE RESTRICT;

COMMIT;
