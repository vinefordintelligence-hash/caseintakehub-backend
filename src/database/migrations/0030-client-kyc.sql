-- 0030 — Authoritative client KYC and protected document linkage
-- Additive only: creates empty tables and policies; no business row is updated.
BEGIN;

CREATE TABLE IF NOT EXISTS public.client_kyc (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  related_case_id uuid REFERENCES public.cases(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending_submission' CHECK(status IN ('pending_submission','under_review','more_information_required','verified','rejected','expired')),
  legal_name text NOT NULL,
  date_of_birth date,
  address_line text,
  country text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  verified_at timestamptz,
  expires_at timestamptz,
  reviewer_id uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  internal_review_notes text,
  client_action_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,client_id)
);
CREATE INDEX IF NOT EXISTS idx_client_kyc_review_queue ON public.client_kyc(organization_id,status,submitted_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.kyc_requirements (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  kyc_id uuid NOT NULL REFERENCES public.client_kyc(id) ON DELETE RESTRICT,
  requirement_type text NOT NULL CHECK(requirement_type IN ('government_photo_id','proof_of_address','account_ownership','other')),
  title text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'missing' CHECK(status IN ('missing','submitted','under_review','verified','rejected')),
  client_instructions text,
  client_action_reason text,
  current_document_id uuid,
  reviewed_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kyc_id,requirement_type)
);
CREATE INDEX IF NOT EXISTS idx_kyc_requirements_record ON public.kyc_requirements(organization_id,kyc_id,status);

CREATE TABLE IF NOT EXISTS public.kyc_documents (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  kyc_id uuid NOT NULL REFERENCES public.client_kyc(id) ON DELETE RESTRICT,
  requirement_id uuid NOT NULL REFERENCES public.kyc_requirements(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  related_case_id uuid REFERENCES public.cases(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  document_type text NOT NULL CHECK(document_type IN ('passport','drivers_license','national_identity_card','government_photo_id','proof_of_address','bank_statement','voided_check','other')),
  storage_key text NOT NULL UNIQUE,
  original_file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL CHECK(file_size > 0 AND file_size <= 8388608),
  sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','under_review','verified','rejected')),
  document_expires_at date,
  reviewed_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  client_action_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kyc_requirements DROP CONSTRAINT IF EXISTS kyc_requirements_current_document_fkey;
ALTER TABLE public.kyc_requirements ADD CONSTRAINT kyc_requirements_current_document_fkey FOREIGN KEY(current_document_id) REFERENCES public.kyc_documents(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_kyc_documents_record ON public.kyc_documents(organization_id,kyc_id,requirement_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.kyc_status_history (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  kyc_id uuid NOT NULL REFERENCES public.client_kyc(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  client_action_reason text,
  changed_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kyc_status_history_record ON public.kyc_status_history(organization_id,kyc_id,created_at);

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['client_kyc','kyc_requirements','kyc_documents','kyc_status_history'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name AND policyname='vineford_backend_select') THEN EXECUTE format('CREATE POLICY vineford_backend_select ON public.%I FOR SELECT TO vineford_app USING(true)',table_name); END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name AND policyname='vineford_backend_insert') THEN EXECUTE format('CREATE POLICY vineford_backend_insert ON public.%I FOR INSERT TO vineford_app WITH CHECK(true)',table_name); END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name AND policyname='vineford_backend_update') THEN EXECUTE format('CREATE POLICY vineford_backend_update ON public.%I FOR UPDATE TO vineford_app USING(true) WITH CHECK(true)',table_name); END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',table_name);
  END LOOP;
END $rls$;
GRANT SELECT,INSERT,UPDATE ON public.client_kyc,public.kyc_requirements,public.kyc_documents TO vineford_app;
GRANT SELECT,INSERT ON public.kyc_status_history TO vineford_app;
COMMIT;
