-- ============================================================
-- 0010 — CASE WORKFLOW: TRANSFER PREPARATION -> CASE REVIEW
-- Target DB : vineford_intake_test
--
-- Implements a 5-phase auditable workflow per case:
--   PHASE 1 transfer_preparation
--   PHASE 2 receiving_bank_review
--   PHASE 3 bank_acceptance_verification
--   PHASE 4 document_verification
--   PHASE 5 case_review  (status update)  -> completed
--
-- Financial-event integrity:
--   * transfer_status distinguishes prepared/under_review/verified/
--     authorized/executed/rejected/cancelled
--   * transfer_mode (demo|sandbox|live) is recorded explicitly
--   * CHECK constraints make it IMPOSSIBLE to mark a demo/sandbox
--     transfer as executed, and impossible to mark a transfer
--     executed without a real execution_confirmation_reference.
--   * Every transition writes a timeline event + audit_logs row via
--     SECURITY DEFINER helpers (bypass RLS, single source of truth).
--
-- NON-DESTRUCTIVE: CREATE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS,
-- no deletes, no overwrite of existing values.
-- Run as: postgres superuser.
-- ============================================================

BEGIN;

-- ── 1. Enum types ───────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_status') THEN
    CREATE TYPE public.transfer_status AS ENUM ('prepared','under_review','verified','authorized','executed','rejected','cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_mode') THEN
    CREATE TYPE public.transfer_mode AS ENUM ('demo','sandbox','live');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_phase') THEN
    CREATE TYPE public.workflow_phase AS ENUM ('transfer_preparation','receiving_bank_review','bank_acceptance_verification','document_verification','case_review','completed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_requirement_status') THEN
    CREATE TYPE public.document_requirement_status AS ENUM ('required','submitted','under_review','verified','rejected');
  END IF;
END $$;

-- ── 2. case_transfers ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.case_transfers (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  transfer_reference text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'USD',
  mode public.transfer_mode NOT NULL DEFAULT 'demo',
  status public.transfer_status NOT NULL DEFAULT 'prepared',
  prepared_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  prepared_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  receiving_institution_name text,
  receiving_institution_branch text,
  receiving_institution_city text,
  receiving_institution_country text,
  receiving_institution_swift text,
  receiving_institution_routing_number text,
  receiving_account_number text,
  receiving_account_type text,
  beneficiary_name text,
  beneficiary_legal_name text,
  beneficiary_email text,
  beneficiary_phone text,
  beneficiary_id_type text,
  beneficiary_id_number text,
  receiving_details_verified boolean NOT NULL DEFAULT false,
  receiving_details_verified_at timestamptz,
  receiving_details_verified_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  receiving_details_verification_note text,
  acceptance_verified boolean NOT NULL DEFAULT false,
  acceptance_verified_at timestamptz,
  acceptance_verified_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  acceptance_verification_note text,
  execution_confirmed boolean NOT NULL DEFAULT false,
  execution_confirmed_at timestamptz,
  execution_confirmation_reference text,
  executed_at timestamptz,
  description text,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT case_transfers_case_ref_key UNIQUE (case_id, transfer_reference),
  -- A transfer may only be EXECUTED with real operator confirmation:
  CONSTRAINT case_transfers_execution_guard CHECK (
    (status <> 'executed') OR (execution_confirmed AND execution_confirmation_reference IS NOT NULL)
  ),
  -- Demo/sandbox transfers can NEVER be confirmed as executed:
  CONSTRAINT case_transfers_demo_no_execution CHECK (
    (mode = 'live') OR (NOT execution_confirmed)
  ),
  -- Executed transfers must carry real confirmation + timestamp:
  CONSTRAINT case_transfers_executed_fields CHECK (
    (status <> 'executed') OR (executed_at IS NOT NULL AND execution_confirmed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_case_transfers_case_id ON public.case_transfers(case_id);
CREATE INDEX IF NOT EXISTS idx_case_transfers_status ON public.case_transfers(status);
CREATE INDEX IF NOT EXISTS idx_case_transfers_mode   ON public.case_transfers(mode);

-- ── 3. transfer_document_requirements ───────────────────────
CREATE TABLE IF NOT EXISTS public.transfer_document_requirements (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  transfer_id uuid REFERENCES public.case_transfers(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requirement_key text NOT NULL,
  title text NOT NULL,
  description text,
  category text,
  status public.document_requirement_status NOT NULL DEFAULT 'required',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  submitted_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  review_note text,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tdr_transfer_key ON public.transfer_document_requirements (transfer_id, requirement_key) WHERE transfer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tdr_case_key     ON public.transfer_document_requirements (case_id, requirement_key) WHERE transfer_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_tdr_case_id    ON public.transfer_document_requirements(case_id);
CREATE INDEX IF NOT EXISTS idx_tdr_transfer_id ON public.transfer_document_requirements(transfer_id);
CREATE INDEX IF NOT EXISTS idx_tdr_status     ON public.transfer_document_requirements(status);

-- ── 4. cases workflow columns ───────────────────────────────
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS workflow_phase public.workflow_phase NOT NULL DEFAULT 'transfer_preparation';
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS workflow_phase_number integer NOT NULL DEFAULT 1;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS workflow_updated_at timestamptz;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS current_transfer_id uuid REFERENCES public.case_transfers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cases_workflow_phase ON public.cases(workflow_phase);

ALTER TABLE public.case_transfers            OWNER TO vineford_app;
ALTER TABLE public.transfer_document_requirements OWNER TO vineford_app;

ALTER TABLE public.case_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_document_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System can insert case_transfers" ON public.case_transfers FOR INSERT WITH CHECK (true);
CREATE POLICY "System can insert transfer_document_requirements" ON public.transfer_document_requirements FOR INSERT WITH CHECK (true);

DROP TRIGGER IF EXISTS trigger_update_case_transfers_updated_at ON public.case_transfers;
CREATE TRIGGER trigger_update_case_transfers_updated_at BEFORE UPDATE ON public.case_transfers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trigger_update_transfer_document_requirements_updated_at ON public.transfer_document_requirements;
CREATE TRIGGER trigger_update_transfer_document_requirements_updated_at BEFORE UPDATE ON public.transfer_document_requirements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 5. Audited helpers (SECURITY DEFINER => bypass RLS) ──────
-- vf_log_audit: writes an immutable audit_logs row
CREATE OR REPLACE FUNCTION public.vf_log_audit(
  p_org uuid, p_user uuid, p_action text, p_resource_type text, p_resource_id uuid,
  p_changes jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.audit_logs (organization_id, user_id, action, resource_type, resource_id, changes)
  VALUES (p_org, p_user, p_action, p_resource_type, p_resource_id, p_changes)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- vf_append_timeline: writes a timeline event for a case
CREATE OR REPLACE FUNCTION public.vf_append_timeline(
  p_case uuid, p_org uuid, p_title text, p_description text, p_event_date timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.timeline (case_id, organization_id, title, description, event_date, created_at, updated_at)
  VALUES (p_case, p_org, p_title, p_description, p_event_date, p_event_date, p_event_date)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- vf_create_transfer: PHASE 1 — prepare a transfer (always PREPARED)
CREATE OR REPLACE FUNCTION public.vf_create_transfer(
  p_case uuid, p_org uuid, p_reference text, p_amount numeric, p_currency text DEFAULT 'USD',
  p_mode text DEFAULT 'demo',
  p_receiving_institution text DEFAULT NULL, p_receiving_city text DEFAULT NULL,
  p_receiving_country text DEFAULT NULL, p_receiving_routing text DEFAULT NULL,
  p_receiving_account text DEFAULT NULL, p_receiving_account_type text DEFAULT NULL,
  p_beneficiary text DEFAULT NULL, p_beneficiary_legal text DEFAULT NULL,
  p_prepared_by uuid DEFAULT NULL, p_description text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tid uuid;
  v_mode public.transfer_mode;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('demo','sandbox','live') THEN
    v_mode := 'demo'::public.transfer_mode;
  ELSE
    v_mode := p_mode::public.transfer_mode;
  END IF;

  INSERT INTO public.case_transfers (
    case_id, organization_id, transfer_reference, amount, currency, mode, status,
    prepared_at, prepared_by, receiving_institution_name, receiving_institution_city,
    receiving_institution_country, receiving_institution_routing_number, receiving_account_number,
    receiving_account_type, beneficiary_name, beneficiary_legal_name, description
  ) VALUES (
    p_case, p_org, p_reference, p_amount, COALESCE(p_currency,'USD'), v_mode, 'prepared',
    now(), p_prepared_by, p_receiving_institution, p_receiving_city, p_receiving_country,
    p_receiving_routing, p_receiving_account, p_receiving_account_type,
    p_beneficiary, p_beneficiary_legal, p_description
  ) RETURNING id INTO v_tid;

  UPDATE public.cases
  SET current_transfer_id = v_tid,
      workflow_phase = 'transfer_preparation',
      workflow_phase_number = 1,
      workflow_updated_at = now()
  WHERE id = p_case;

  PERFORM public.vf_append_timeline(
    p_case, p_org,
    'Transfer Prepared (' || upper(v_mode::text) || ')',
    'Transfer ' || p_reference || ' of $' || p_amount || ' ' || COALESCE(p_currency,'USD') ||
    ' prepared for receipt. Mode: ' || v_mode || '. Status: PREPARED — NOT yet reviewed or executed.',
    now()
  );

  PERFORM public.vf_log_audit(
    p_org, p_prepared_by, 'transfer_prepared', 'transfer', v_tid,
    jsonb_build_object('reference', p_reference, 'amount', p_amount, 'currency', COALESCE(p_currency,'USD'),
                       'mode', v_mode::text, 'status', 'prepared')
  );

  RETURN (SELECT jsonb_build_object(
    'id', id, 'case_id', case_id, 'transfer_reference', transfer_reference,
    'amount', amount, 'currency', currency, 'mode', mode, 'status', status, 'prepared_at', prepared_at
  ) FROM public.case_transfers WHERE id = v_tid);
END $$;

-- vf_submit_transfer_for_review: PHASE 2 — receiving bank review
CREATE OR REPLACE FUNCTION public.vf_submit_transfer_for_review(
  p_transfer uuid, p_actor uuid, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_case uuid; v_org uuid; v_ref text;
BEGIN
  SELECT case_id, organization_id, transfer_reference INTO v_case, v_org, v_ref
  FROM public.case_transfers WHERE id = p_transfer;
  IF v_case IS NULL THEN RAISE EXCEPTION 'transfer % not found', p_transfer; END IF;

  UPDATE public.case_transfers
  SET status = 'under_review', updated_at = now()
  WHERE id = p_transfer;

  UPDATE public.cases
  SET workflow_phase = 'receiving_bank_review',
      workflow_phase_number = 2,
      workflow_updated_at = now()
  WHERE id = v_case;

  PERFORM public.vf_append_timeline(
    v_case, v_org, 'Receiving Bank Review',
    'Transfer ' || v_ref || ' submitted for receiving-bank and beneficiary information review. Status: UNDER_REVIEW.' ||
    COALESCE(' ' || p_note, ''),
    now()
  );
  PERFORM public.vf_log_audit(
    v_org, p_actor, 'transfer_submitted_for_review', 'transfer', p_transfer,
    jsonb_build_object('status', 'under_review', 'note', p_note)
  );

  RETURN (SELECT jsonb_build_object('id', id, 'status', status, 'updated_at', updated_at)
          FROM public.case_transfers WHERE id = p_transfer);
END $$;

-- vf_verify_receiving_details: PHASE 3 — bank acceptance verification
-- Records whether receiving details have been verified. Does NOT
-- represent the transfer as completed or executed.
CREATE OR REPLACE FUNCTION public.vf_verify_receiving_details(
  p_transfer uuid, p_actor uuid, p_verified boolean, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_case uuid; v_org uuid; v_ref text;
BEGIN
  SELECT case_id, organization_id, transfer_reference INTO v_case, v_org, v_ref
  FROM public.case_transfers WHERE id = p_transfer;
  IF v_case IS NULL THEN RAISE EXCEPTION 'transfer % not found', p_transfer; END IF;

  UPDATE public.case_transfers
  SET receiving_details_verified = p_verified,
      receiving_details_verified_at = now(),
      receiving_details_verified_by = p_actor,
      receiving_details_verification_note = p_note,
      acceptance_verified = p_verified,
      acceptance_verified_at = now(),
      acceptance_verified_by = p_actor,
      acceptance_verification_note = p_note,
      status = CASE WHEN p_verified THEN 'verified'::public.transfer_status ELSE 'under_review'::public.transfer_status END,
      updated_at = now()
  WHERE id = p_transfer;

  UPDATE public.cases
  SET workflow_phase = 'bank_acceptance_verification',
      workflow_phase_number = 3,
      workflow_updated_at = now()
  WHERE id = v_case;

  PERFORM public.vf_append_timeline(
    v_case, v_org,
    'Bank Acceptance Verification',
    'Receiving/bank details for transfer ' || v_ref || ' verified: ' || p_verified ||
    '. Status: ' || CASE WHEN p_verified THEN 'VERIFIED' ELSE 'UNDER_REVIEW' END ||
    '. This is NOT a confirmation that the transfer was completed.' ||
    COALESCE(' ' || p_note, ''),
    now()
  );
  PERFORM public.vf_log_audit(
    v_org, p_actor, CASE WHEN p_verified THEN 'receiving_details_verified' ELSE 'receiving_details_rejected' END,
    'transfer', p_transfer,
    jsonb_build_object('verified', p_verified, 'note', p_note)
  );

  RETURN (SELECT jsonb_build_object(
    'id', id, 'status', status, 'receiving_details_verified', receiving_details_verified,
    'acceptance_verified', acceptance_verified, 'updated_at', updated_at
  ) FROM public.case_transfers WHERE id = p_transfer);
END $$;

-- vf_add_requirement: PHASE 4 — create a configurable document requirement
CREATE OR REPLACE FUNCTION public.vf_add_requirement(
  p_case uuid, p_org uuid, p_key text, p_title text, p_description text DEFAULT NULL,
  p_category text DEFAULT NULL, p_transfer uuid DEFAULT NULL, p_sort integer DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.transfer_document_requirements
    (case_id, transfer_id, organization_id, requirement_key, title, description, category, status, sort_order)
  VALUES (p_case, p_transfer, p_org, p_key, p_title, p_description, p_category, 'required', p_sort)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- vf_set_requirement_status: PHASE 4 — lifecycle transition
-- REQUIRED -> SUBMITTED -> UNDER_REVIEW -> VERIFIED / REJECTED
CREATE OR REPLACE FUNCTION public.vf_set_requirement_status(
  p_req uuid, p_status text, p_actor uuid, p_note text DEFAULT NULL, p_document uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_case uuid; v_org uuid; v_title text; v_current public.document_requirement_status;
  v_transfer uuid;
BEGIN
  SELECT case_id, organization_id, title, status, transfer_id INTO v_case, v_org, v_title, v_current, v_transfer
  FROM public.transfer_document_requirements WHERE id = p_req;
  IF v_case IS NULL THEN RAISE EXCEPTION 'requirement % not found', p_req; END IF;

  UPDATE public.transfer_document_requirements
  SET status = p_status::public.document_requirement_status,
      submitted_document_id = COALESCE(p_document, submitted_document_id),
      submitted_at = CASE WHEN p_status = 'submitted' THEN now() ELSE submitted_at END,
      submitted_by = CASE WHEN p_status = 'submitted' THEN p_actor ELSE submitted_by END,
      reviewed_at = CASE WHEN p_status IN ('verified','rejected') THEN now() ELSE reviewed_at END,
      reviewed_by = CASE WHEN p_status IN ('verified','rejected') THEN p_actor ELSE reviewed_by END,
      review_note = COALESCE(p_note, review_note),
      updated_at = now()
  WHERE id = p_req;

  -- Move the case into the document-verification phase if it is not already past it
  UPDATE public.cases
  SET workflow_phase = 'document_verification',
      workflow_phase_number = 4,
      workflow_updated_at = now()
  WHERE id = v_case
    AND workflow_phase NOT IN ('case_review','completed');

  PERFORM public.vf_append_timeline(
    v_case, v_org,
    'Document Requirement ' || upper(p_status::text),
    'Requirement "' || v_title || '" moved to ' || upper(p_status::text) ||
    COALESCE(' — ' || p_note, '') || '.',
    now()
  );
  PERFORM public.vf_log_audit(
    v_org, p_actor, 'requirement_' || lower(p_status::text), 'transfer_document_requirement', p_req,
    jsonb_build_object('title', v_title, 'status', p_status, 'transfer_id', v_transfer, 'note', p_note)
  );

  RETURN (SELECT jsonb_build_object('id', id, 'status', status, 'review_note', review_note, 'updated_at', updated_at)
          FROM public.transfer_document_requirements WHERE id = p_req);
END $$;

-- vf_advance_case_phase: PHASE 5 — auditable status update / phase advance
CREATE OR REPLACE FUNCTION public.vf_advance_case_phase(
  p_case uuid, p_actor uuid, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_phase public.workflow_phase; v_num integer; v_next public.workflow_phase; v_next_num integer;
BEGIN
  SELECT organization_id, workflow_phase, workflow_phase_number INTO v_org, v_phase, v_num
  FROM public.cases WHERE id = p_case;
  IF v_org IS NULL THEN RAISE EXCEPTION 'case % not found', p_case; END IF;

  IF v_phase = 'completed' THEN
    RAISE EXCEPTION 'case already completed';
  END IF;

  v_next_num := v_num + 1;
  v_next := CASE v_next_num
    WHEN 2 THEN 'receiving_bank_review'::public.workflow_phase
    WHEN 3 THEN 'bank_acceptance_verification'::public.workflow_phase
    WHEN 4 THEN 'document_verification'::public.workflow_phase
    WHEN 5 THEN 'case_review'::public.workflow_phase
    WHEN 6 THEN 'completed'::public.workflow_phase
    ELSE 'case_review'::public.workflow_phase
  END;

  UPDATE public.cases
  SET workflow_phase = v_next,
      workflow_phase_number = v_next_num,
      workflow_updated_at = now()
  WHERE id = p_case;

  PERFORM public.vf_append_timeline(
    p_case, v_org, 'Workflow Advanced',
    'Case workflow advanced from phase ' || v_num || ' (' || v_phase || ') to phase ' ||
    v_next_num || ' (' || v_next || ').' || COALESCE(' ' || p_note, ''),
    now()
  );
  PERFORM public.vf_log_audit(
    v_org, p_actor, 'case_phase_advanced', 'case', p_case,
    jsonb_build_object('from_phase', v_phase::text, 'to_phase', v_next::text, 'from_number', v_num, 'to_number', v_next_num, 'note', p_note)
  );

  RETURN jsonb_build_object('case_id', p_case, 'from_phase', v_phase, 'to_phase', v_next, 'from_number', v_num, 'to_number', v_next_num);
END $$;

-- vf_complete_case_review: finish PHASE 5 — requires ALL active
-- requirements verified; creates auditable update and completes workflow.
CREATE OR REPLACE FUNCTION public.vf_complete_case_review(
  p_case uuid, p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_pending integer;
BEGIN
  SELECT organization_id INTO v_org FROM public.cases WHERE id = p_case;
  IF v_org IS NULL THEN RAISE EXCEPTION 'case % not found', p_case; END IF;

  SELECT count(*) INTO v_pending
  FROM public.transfer_document_requirements
  WHERE case_id = p_case AND is_active AND status <> 'verified';

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'cannot complete case review: % active requirement(s) are not VERIFIED', v_pending;
  END IF;

  UPDATE public.cases
  SET workflow_phase = 'completed',
      workflow_phase_number = 6,
      workflow_updated_at = now()
  WHERE id = p_case;

  PERFORM public.vf_append_timeline(
    p_case, v_org, 'Case Review Completed',
    'All verification conditions satisfied. Case workflow completed with auditable status update. ' ||
    'No transfer funds movement is represented unless a real execution confirmation was recorded.',
    now()
  );
  PERFORM public.vf_log_audit(
    v_org, p_actor, 'case_review_completed', 'case', p_case,
    jsonb_build_object('workflow_phase', 'completed', 'workflow_phase_number', 6)
  );

  RETURN jsonb_build_object('case_id', p_case, 'workflow_phase', 'completed', 'workflow_phase_number', 6);
END $$;

-- vf_execute_transfer: ONLY for LIVE transfers with a REAL operator
-- confirmation reference. Raises on demo/sandbox and on missing confirmation.
CREATE OR REPLACE FUNCTION public.vf_execute_transfer(
  p_transfer uuid, p_actor uuid, p_confirmation_reference text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_case uuid; v_org uuid; v_ref text; v_mode public.transfer_mode; v_verified boolean;
BEGIN
  SELECT case_id, organization_id, transfer_reference, mode, receiving_details_verified
  INTO v_case, v_org, v_ref, v_mode, v_verified
  FROM public.case_transfers WHERE id = p_transfer;
  IF v_case IS NULL THEN RAISE EXCEPTION 'transfer % not found', p_transfer; END IF;

  IF v_mode <> 'live' THEN
    RAISE EXCEPTION 'transfer % is mode % — DEMO/SANDBOX transfers cannot be represented as executed', v_ref, v_mode;
  END IF;
  IF p_confirmation_reference IS NULL OR btrim(p_confirmation_reference) = '' THEN
    RAISE EXCEPTION 'execution requires a real operator-supplied transaction confirmation reference';
  END IF;
  IF NOT v_verified THEN
    RAISE EXCEPTION 'transfer % has not had receiving details verified', v_ref;
  END IF;

  UPDATE public.case_transfers
  SET execution_confirmed = true,
      execution_confirmed_at = now(),
      execution_confirmation_reference = p_confirmation_reference,
      status = 'executed',
      executed_at = now(),
      updated_at = now()
  WHERE id = p_transfer;

  PERFORM public.vf_append_timeline(
    v_case, v_org, 'Transfer Executed',
    'Transfer ' || v_ref || ' EXECUTED with real confirmation reference ' || p_confirmation_reference || '.',
    now()
  );
  PERFORM public.vf_log_audit(
    v_org, p_actor, 'transfer_executed', 'transfer', p_transfer,
    jsonb_build_object('reference', v_ref, 'status', 'executed', 'execution_confirmation_reference', p_confirmation_reference)
  );

  RETURN (SELECT jsonb_build_object(
    'id', id, 'status', status, 'execution_confirmed', execution_confirmed,
    'execution_confirmation_reference', execution_confirmation_reference, 'executed_at', executed_at
  ) FROM public.case_transfers WHERE id = p_transfer);
END $$;

-- vf_get_case_workflow: read-only workflow state (case + transfers +
-- requirements + timeline + audit) — bypasses RLS for the application.
CREATE OR REPLACE FUNCTION public.vf_get_case_workflow(p_case uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'case_id', c.id,
    'case_number', c.case_number,
    'workflow_phase', c.workflow_phase,
    'workflow_phase_number', c.workflow_phase_number,
    'workflow_updated_at', c.workflow_updated_at,
    'transfers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'transfer_reference', t.transfer_reference, 'amount', t.amount,
        'currency', t.currency, 'mode', t.mode, 'status', t.status, 'prepared_at', t.prepared_at,
        'receiving_institution_name', t.receiving_institution_name,
        'beneficiary_name', t.beneficiary_name, 'beneficiary_legal_name', t.beneficiary_legal_name,
        'receiving_details_verified', t.receiving_details_verified,
        'acceptance_verified', t.acceptance_verified,
        'execution_confirmed', t.execution_confirmed,
        'execution_confirmation_reference', t.execution_confirmation_reference,
        'executed_at', t.executed_at
      ) ORDER BY t.prepared_at)
      FROM public.case_transfers t WHERE t.case_id = c.id
    ), '[]'::jsonb),
    'requirements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'requirement_key', r.requirement_key, 'title', r.title,
        'category', r.category, 'status', r.status, 'transfer_id', r.transfer_id,
        'review_note', r.review_note, 'submitted_document_id', r.submitted_document_id,
        'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at
      ) ORDER BY r.sort_order, r.created_at)
      FROM public.transfer_document_requirements r WHERE r.case_id = c.id AND r.is_active
    ), '[]'::jsonb),
    'timeline', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description, 'event_date', e.event_date) ORDER BY e.event_date)
      FROM public.timeline e WHERE e.case_id = c.id
    ), '[]'::jsonb),
    'audit', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'resource_type', a.resource_type, 'changes', a.changes, 'created_at', a.created_at) ORDER BY a.created_at)
      FROM public.audit_logs a WHERE a.resource_id = c.id OR a.resource_id IN (SELECT t.id FROM public.case_transfers t WHERE t.case_id = c.id)
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.cases c WHERE c.id = p_case;

  IF v_result IS NULL THEN RAISE EXCEPTION 'case % not found', p_case; END IF;
  RETURN v_result;
END $$;

-- vf_get_case_history: read-only historical record counts for the case
CREATE OR REPLACE FUNCTION public.vf_get_case_history(p_case uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'case_id', c.id,
    'case_number', c.case_number,
    'documents', (SELECT count(*)::int FROM public.documents d WHERE d.case_id = c.id),
    'evidence', (SELECT count(*)::int FROM public.evidence e WHERE e.case_id = c.id),
    'timeline_events', (SELECT count(*)::int FROM public.timeline t WHERE t.case_id = c.id),
    'messages', (SELECT count(*)::int FROM public.messages m WHERE m.case_id = c.id),
    'invoices', (SELECT count(*)::int FROM public.invoices i WHERE i.case_id = c.id),
    'invoice_line_items', (SELECT count(*)::int FROM public.invoice_line_items li WHERE li.invoice_id IN (SELECT id FROM public.invoices i2 WHERE i2.case_id = c.id)),
    'payments', (SELECT count(*)::int FROM public.payments p WHERE p.invoice_id IN (SELECT id FROM public.invoices i3 WHERE i3.case_id = c.id)),
    'document_requests', (SELECT count(*)::int FROM public.document_requests dr WHERE dr.case_id = c.id),
    'engagement_signatures', (SELECT count(*)::int FROM public.engagement_signatures es WHERE es.case_id = c.id),
    'case_phases', 0,
    'assigned_investigator_id', c.assigned_investigator_id,
    'engagement_template_id', c.engagement_template_id
  ) INTO v_result
  FROM public.cases c WHERE c.id = p_case;
  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.vf_log_audit(uuid, uuid, text, text, uuid, jsonb) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_append_timeline(uuid, uuid, text, text, timestamptz) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_create_transfer(uuid, uuid, text, numeric, text, text, text, text, text, text, text, text, text, text, uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_submit_transfer_for_review(uuid, uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_verify_receiving_details(uuid, uuid, boolean, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_add_requirement(uuid, uuid, text, text, text, text, uuid, integer) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_set_requirement_status(uuid, text, uuid, text, uuid) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_advance_case_phase(uuid, uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_complete_case_review(uuid, uuid) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_execute_transfer(uuid, uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_case_workflow(uuid) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_case_history(uuid) TO vineford_app;

COMMIT;
