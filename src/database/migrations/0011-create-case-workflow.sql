-- ============================================================
-- 0011 — CASE WORKFLOW: SIX-PHASE CHRONOLOGICAL WORKFLOW
-- Target DB : vineford_intake_test
--
-- Implements the auditable chronological case workflow:
--   PHASE 1        Transfer Prepared
--   PHASE 2        Receiving Bank Review
--   PHASE 3        Verification Documents Requested
--   CLIENT ACTION  Client uploads required documents
--   PHASE 4        Documents Under Review
--   PHASE 5        Documents Verified
--   PHASE 6        Next Authorized Client Action
--
-- Financial-event integrity (carried over from 0010):
--   * A PREPARED transfer is NEVER represented as sent/settled/
--     completed/received.
--   * demo/sandbox transfers can never be marked executed and
--     execution always requires a real confirmation reference.
--   * Every state transition writes an immutable timeline event
--     and an audit_logs row (SECURITY DEFINER, single source of
--     truth, bypasses RLS).
--
-- NON-DESTRUCTIVE: ALTER TYPE ... ADD VALUE + ADD COLUMN IF NOT
-- EXISTS. Existing case records are never deleted or overwritten.
--
-- IMPORTANT: the ALTER TYPE statements at the top MUST run in
-- their own transactions (psql autocommit) before the transaction
-- below uses the new enum values. Run with plain `psql file.sql`,
-- NOT `psql -1 file.sql`.
-- Run as: postgres superuser.
-- ============================================================

-- ── 0. Enum extensions (own transactions) ────────────────────
ALTER TYPE public.workflow_phase ADD VALUE IF NOT EXISTS 'verification_documents_requested' AFTER 'receiving_bank_review';
ALTER TYPE public.workflow_phase ADD VALUE IF NOT EXISTS 'documents_under_review' AFTER 'verification_documents_requested';
ALTER TYPE public.workflow_phase ADD VALUE IF NOT EXISTS 'documents_verified' AFTER 'documents_under_review';
ALTER TYPE public.workflow_phase ADD VALUE IF NOT EXISTS 'next_client_action' AFTER 'documents_verified';
ALTER TYPE public.document_requirement_status ADD VALUE IF NOT EXISTS 'needs_information' AFTER 'rejected';

BEGIN;

-- ── 1. timeline: workflow event columns ──────────────────────
ALTER TABLE public.timeline
  ADD COLUMN IF NOT EXISTS phase text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS actor_id uuid,
  ADD COLUMN IF NOT EXISTS actor_name text,
  ADD COLUMN IF NOT EXISTS is_client_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS transfer_id uuid,
  ADD COLUMN IF NOT EXISTS document_id uuid,
  ADD COLUMN IF NOT EXISTS requirement_id uuid,
  ADD COLUMN IF NOT EXISTS amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS transfer_reference text,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_timeline_actor') THEN
    ALTER TABLE public.timeline ADD CONSTRAINT fk_timeline_actor FOREIGN KEY (actor_id) REFERENCES public.app_users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_timeline_transfer') THEN
    ALTER TABLE public.timeline ADD CONSTRAINT fk_timeline_transfer FOREIGN KEY (transfer_id) REFERENCES public.case_transfers(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_timeline_document') THEN
    ALTER TABLE public.timeline ADD CONSTRAINT fk_timeline_document FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_timeline_requirement') THEN
    ALTER TABLE public.timeline ADD CONSTRAINT fk_timeline_requirement FOREIGN KEY (requirement_id) REFERENCES public.transfer_document_requirements(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_timeline_phase           ON public.timeline(phase);
CREATE INDEX IF NOT EXISTS idx_timeline_status          ON public.timeline(status);
CREATE INDEX IF NOT EXISTS idx_timeline_actor           ON public.timeline(actor_id);
CREATE INDEX IF NOT EXISTS idx_timeline_client_visible  ON public.timeline(is_client_visible);

-- ── 2. documents: upload lifecycle / visibility columns ──────
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS document_status text NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS is_client_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS uploaded_by uuid,
  ADD COLUMN IF NOT EXISTS uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

UPDATE public.documents SET uploaded_at = created_at WHERE uploaded_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_status_check') THEN
    ALTER TABLE public.documents ADD CONSTRAINT documents_status_check CHECK (document_status IN ('required','submitted','under_review','verified','rejected','needs_information'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_uploaded_by_fkey') THEN
    ALTER TABLE public.documents ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.app_users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_status     ON public.documents(document_status);
CREATE INDEX IF NOT EXISTS idx_documents_client_vis ON public.documents(is_client_visible);

-- ── 3. transfer_document_requirements: client visibility ─────
ALTER TABLE public.transfer_document_requirements
  ADD COLUMN IF NOT EXISTS is_client_visible boolean NOT NULL DEFAULT true;

-- ── 4. case_client_actions (PHASE 6) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.case_client_actions (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  action_url text,
  action_label text,
  status text NOT NULL DEFAULT 'active',
  is_client_visible boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  activated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  metadata jsonb,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT case_client_actions_status_check CHECK (status IN ('active','inactive'))
);

CREATE INDEX IF NOT EXISTS idx_case_client_actions_case_id ON public.case_client_actions(case_id);
CREATE INDEX IF NOT EXISTS idx_case_client_actions_status  ON public.case_client_actions(status);

ALTER TABLE public.case_client_actions OWNER TO vineford_app;
ALTER TABLE public.case_client_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System can insert case_client_actions" ON public.case_client_actions FOR INSERT WITH CHECK (true);

DROP TRIGGER IF EXISTS trigger_update_case_client_actions_updated_at ON public.case_client_actions;
CREATE TRIGGER trigger_update_case_client_actions_updated_at BEFORE UPDATE ON public.case_client_actions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 5. Helpers ───────────────────────────────────────────────
-- Resolve a user display name for timeline events.
CREATE OR REPLACE FUNCTION public.vf_actor_name(p_actor uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE((SELECT name FROM public.app_users WHERE id = p_actor), 'System')
$$;

-- Mask a sensitive account/routing number (e.g. "****2501").
CREATE OR REPLACE FUNCTION public.vf_mask_account(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN char_length(p_value) <= 4 THEN p_value
    ELSE '****' || right(p_value, 4)
  END
$$;

-- vf_append_event: full-featured timeline event writer.
CREATE OR REPLACE FUNCTION public.vf_append_event(
  p_case uuid, p_org uuid, p_title text, p_description text,
  p_phase text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_actor uuid DEFAULT NULL,
  p_is_client_visible boolean DEFAULT true,
  p_transfer_id uuid DEFAULT NULL,
  p_transfer_reference text DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_currency text DEFAULT NULL,
  p_document_id uuid DEFAULT NULL,
  p_requirement_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL,
  p_event_date timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.timeline (
    case_id, organization_id, title, description, event_date,
    phase, status, actor_id, actor_name, is_client_visible,
    transfer_id, transfer_reference, amount, currency,
    document_id, requirement_id, metadata,
    created_at, updated_at
  ) VALUES (
    p_case, p_org, p_title, p_description, p_event_date,
    p_phase, p_status, p_actor, public.vf_actor_name(p_actor), p_is_client_visible,
    p_transfer_id, p_transfer_reference, p_amount, p_currency,
    p_document_id, p_requirement_id, p_metadata,
    p_event_date, p_event_date
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ── 6. PHASE 1 — Transfer Prepared ───────────────────────────
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

  PERFORM public.vf_append_event(
    p_case, p_org,
    'Transfer Prepared',
    'Transfer ' || p_reference || ' of $' || p_amount || ' ' || COALESCE(p_currency,'USD') ||
    ' prepared for receipt. Mode: ' || v_mode::text ||
    '. Status: PREPARED — NOT yet reviewed, NOT yet received, and NOT executed.' ||
    ' Receiving-account details are stored UNVERIFIED until the verification document is reviewed.' ||
    COALESCE(' ' || p_description, ''),
    'PHASE 1', 'PREPARED', p_prepared_by, true,
    v_tid, p_reference, p_amount, COALESCE(p_currency,'USD'),
    NULL, NULL, NULL,
    now()
  );
  PERFORM public.vf_log_audit(
    p_org, p_prepared_by, 'transfer_prepared', 'transfer', v_tid,
    jsonb_build_object('reference', p_reference, 'amount', p_amount, 'currency', COALESCE(p_currency,'USD'),
                       'mode', v_mode::text, 'status', 'prepared',
                       'receiving_routing_number', p_receiving_routing, 'receiving_account_number', p_receiving_account)
  );

  RETURN (SELECT jsonb_build_object(
    'id', id, 'case_id', case_id, 'transfer_reference', transfer_reference,
    'amount', amount, 'currency', currency, 'mode', mode, 'status', status, 'prepared_at', prepared_at
  ) FROM public.case_transfers WHERE id = v_tid);
END $$;

-- ── 7. PHASE 2 — Receiving Bank Review ───────────────────────
CREATE OR REPLACE FUNCTION public.vf_submit_transfer_for_review(
  p_transfer uuid, p_actor uuid, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_case uuid; v_org uuid; v_ref text; v_amount numeric; v_currency text;
BEGIN
  SELECT case_id, organization_id, transfer_reference, amount, currency
    INTO v_case, v_org, v_ref, v_amount, v_currency
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

  PERFORM public.vf_append_event(
    v_case, v_org, 'Receiving Bank Review',
    'Receiving-account and beneficiary information for transfer ' || v_ref ||
    ' is being reviewed before proceeding. Status: UNDER_REVIEW.' ||
    ' The receiving bank has NOT accepted or received this transfer.' ||
    COALESCE(' ' || p_note, ''),
    'PHASE 2', 'UNDER_REVIEW', p_actor, true,
    p_transfer, v_ref, v_amount, v_currency, NULL, NULL, NULL, now()
  );
  PERFORM public.vf_log_audit(
    v_org, p_actor, 'transfer_submitted_for_review', 'transfer', p_transfer,
    jsonb_build_object('status', 'under_review', 'note', p_note)
  );

  RETURN (SELECT jsonb_build_object('id', id, 'status', status, 'updated_at', updated_at)
          FROM public.case_transfers WHERE id = p_transfer);
END $$;

-- ── 8. PHASE 3 — Verification Documents Requested ────────────
-- Replaces vf_add_requirement (new p_actor argument added).
DROP FUNCTION IF EXISTS public.vf_add_requirement(uuid, uuid, text, text, text, text, uuid, integer);
CREATE OR REPLACE FUNCTION public.vf_add_requirement(
  p_case uuid, p_org uuid, p_key text, p_title text, p_description text DEFAULT NULL,
  p_category text DEFAULT NULL, p_transfer uuid DEFAULT NULL, p_sort integer DEFAULT 0,
  p_actor uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid; v_ref text; v_amount numeric; v_currency text;
BEGIN
  SELECT transfer_reference, amount, currency INTO v_ref, v_amount, v_currency
  FROM public.case_transfers WHERE id = p_transfer;

  INSERT INTO public.transfer_document_requirements
    (case_id, transfer_id, organization_id, requirement_key, title, description, category, status, sort_order)
  VALUES (p_case, p_transfer, p_org, p_key, p_title, p_description, p_category, 'required', p_sort)
  RETURNING id INTO v_id;

  UPDATE public.cases
  SET workflow_phase = 'verification_documents_requested',
      workflow_phase_number = 3,
      workflow_updated_at = now()
  WHERE id = p_case
    AND workflow_phase NOT IN ('documents_under_review','documents_verified','next_client_action','case_review','completed');

  PERFORM public.vf_append_event(
    p_case, p_org, 'Verification Documents Requested',
    'Required verification document: ' || p_title || '.' ||
    COALESCE(' ' || p_description, '') ||
    COALESCE(' Transfer reference: ' || v_ref || '.', '') ||
    ' Status: REQUIRED — the document must be uploaded and verified before the next authorized client action is available.',
    'PHASE 3', 'REQUIRED', p_actor, true,
    p_transfer, v_ref, v_amount, v_currency, NULL, v_id,
    jsonb_build_object('requirement_key', p_key, 'category', p_category, 'sort_order', p_sort),
    now()
  );
  PERFORM public.vf_log_audit(
    p_org, p_actor, 'verification_documents_requested', 'transfer_document_requirement', v_id,
    jsonb_build_object('title', p_title, 'key', p_key, 'category', p_category, 'transfer_id', p_transfer, 'status', 'required')
  );

  RETURN v_id;
END $$;

-- ── 9. CLIENT ACTION — Document Upload ───────────────────────
CREATE OR REPLACE FUNCTION public.vf_upload_verification_document(
  p_requirement uuid, p_actor uuid, p_title text,
  p_document_type text DEFAULT 'bank_account_verification',
  p_mime_type text DEFAULT NULL,
  p_file_name text DEFAULT NULL,
  p_file_size bigint DEFAULT NULL,
  p_file_url text DEFAULT NULL,
  p_description text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_case uuid; v_org uuid; v_transfer uuid; v_req_title text; v_status text;
  v_doc uuid; v_ref text; v_amount numeric; v_currency text;
BEGIN
  SELECT case_id, organization_id, transfer_id, title, status
    INTO v_case, v_org, v_transfer, v_req_title, v_status
  FROM public.transfer_document_requirements WHERE id = p_requirement;
  IF v_case IS NULL THEN RAISE EXCEPTION 'requirement % not found', p_requirement; END IF;
  IF v_status = 'verified' THEN RAISE EXCEPTION 'requirement % is already verified', p_requirement; END IF;

  INSERT INTO public.documents (
    case_id, organization_id, title, description, document_type,
    file_url, file_name, file_size, mime_type,
    document_status, is_client_visible, uploaded_by, uploaded_at
  ) VALUES (
    v_case, v_org, p_title,
    COALESCE(p_description, 'Uploaded verification document for "' || v_req_title || '".'),
    p_document_type, p_file_url, p_file_name, p_file_size, p_mime_type,
    'submitted', true, p_actor, now()
  ) RETURNING id INTO v_doc;

  UPDATE public.transfer_document_requirements
  SET status = 'submitted',
      submitted_document_id = v_doc,
      submitted_at = now(),
      submitted_by = p_actor,
      updated_at = now()
  WHERE id = p_requirement;

  SELECT transfer_reference, amount, currency INTO v_ref, v_amount, v_currency
  FROM public.case_transfers WHERE id = v_transfer;

  PERFORM public.vf_append_event(
    v_case, v_org, 'Verification Document Submitted',
    'Required document "' || v_req_title || '" was uploaded. Status: SUBMITTED — pending review.',
    'CLIENT ACTION', 'SUBMITTED', p_actor, true,
    v_transfer, v_ref, v_amount, v_currency, v_doc, p_requirement,
    jsonb_build_object('file_name', p_file_name, 'mime_type', p_mime_type, 'file_size', p_file_size, 'document_id', v_doc),
    now()
  );
  PERFORM public.vf_log_audit(
    v_org, p_actor, 'document_uploaded', 'document', v_doc,
    jsonb_build_object('requirement_id', p_requirement, 'title', p_title, 'file_name', p_file_name, 'mime_type', p_mime_type, 'file_size', p_file_size)
  );

  RETURN jsonb_build_object(
    'document', (SELECT jsonb_build_object('id', id, 'title', title, 'file_name', file_name, 'file_size', file_size, 'mime_type', mime_type, 'document_status', document_status, 'uploaded_by', uploaded_by, 'uploaded_at', uploaded_at) FROM public.documents WHERE id = v_doc),
    'requirement', (SELECT jsonb_build_object('id', id, 'status', status, 'submitted_document_id', submitted_document_id, 'submitted_at', submitted_at, 'submitted_by', submitted_by) FROM public.transfer_document_requirements WHERE id = p_requirement)
  );
END $$;

-- ── 10. PHASES 4 & 5 — Documents Under Review / Documents Verified ──
-- Replaces vf_set_requirement_status. Lifecycle:
--   REQUIRED -> SUBMITTED -> UNDER_REVIEW -> VERIFIED / REJECTED / NEEDS_INFORMATION
-- Verification is NEVER automatic: an authorized reviewer drives the
-- transition. When verified, the reviewer's note records that the
-- receiving-account details on the document were checked against the
-- configured account information.
CREATE OR REPLACE FUNCTION public.vf_set_requirement_status(
  p_req uuid, p_status text, p_actor uuid, p_note text DEFAULT NULL, p_document uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_case uuid; v_org uuid; v_title text; v_transfer uuid;
  v_ref text; v_amount numeric; v_currency text;
  v_phase text; v_status text; v_event_title text;
BEGIN
  SELECT case_id, organization_id, title, transfer_id INTO v_case, v_org, v_title, v_transfer
  FROM public.transfer_document_requirements WHERE id = p_req;
  IF v_case IS NULL THEN RAISE EXCEPTION 'requirement % not found', p_req; END IF;

  IF p_status NOT IN ('submitted','under_review','verified','rejected','needs_information') THEN
    RAISE EXCEPTION 'invalid requirement status: %', p_status;
  END IF;

  SELECT transfer_reference, amount, currency INTO v_ref, v_amount, v_currency
  FROM public.case_transfers WHERE id = v_transfer;

  UPDATE public.transfer_document_requirements
  SET status = p_status::public.document_requirement_status,
      submitted_document_id = COALESCE(p_document, submitted_document_id),
      submitted_at = CASE WHEN p_status = 'submitted' THEN now() ELSE submitted_at END,
      submitted_by = CASE WHEN p_status = 'submitted' THEN p_actor ELSE submitted_by END,
      reviewed_at = CASE WHEN p_status IN ('verified','rejected','needs_information') THEN now() ELSE reviewed_at END,
      reviewed_by = CASE WHEN p_status IN ('verified','rejected','needs_information') THEN p_actor ELSE reviewed_by END,
      review_note = COALESCE(p_note, review_note),
      updated_at = now()
  WHERE id = p_req;

  -- Reflect receiving-account verification state on the transfer.
  IF v_transfer IS NOT NULL THEN
    IF p_status = 'verified' THEN
      UPDATE public.case_transfers
      SET receiving_details_verified = true,
          receiving_details_verified_at = now(),
          receiving_details_verified_by = p_actor,
          receiving_details_verification_note = p_note,
          acceptance_verified = true,
          acceptance_verified_at = now(),
          acceptance_verified_by = p_actor,
          acceptance_verification_note = p_note,
          status = 'verified',
          updated_at = now()
      WHERE id = v_transfer;
    ELSIF p_status IN ('rejected','needs_information') THEN
      UPDATE public.case_transfers
      SET receiving_details_verified = false,
          receiving_details_verified_at = now(),
          receiving_details_verified_by = p_actor,
          receiving_details_verification_note = p_note,
          acceptance_verified = false,
          acceptance_verified_at = now(),
          acceptance_verified_by = p_actor,
          acceptance_verification_note = p_note,
          status = 'under_review',
          updated_at = now()
      WHERE id = v_transfer;
    END IF;
  END IF;

  -- Advance the case workflow phase.
  IF p_status = 'verified' THEN
    UPDATE public.cases
    SET workflow_phase = 'documents_verified',
        workflow_phase_number = 5,
        workflow_updated_at = now()
    WHERE id = v_case
      AND workflow_phase <> 'next_client_action';
    v_phase := 'PHASE 5';
    v_status := 'VERIFIED';
    v_event_title := 'Documents Verified';
  ELSIF p_status IN ('under_review','needs_information','rejected') THEN
    UPDATE public.cases
    SET workflow_phase = 'documents_under_review',
        workflow_phase_number = 4,
        workflow_updated_at = now()
    WHERE id = v_case
      AND workflow_phase NOT IN ('documents_verified','next_client_action','case_review','completed');
    v_phase := 'PHASE 4';
    v_status := upper(p_status);
    v_event_title := CASE p_status
      WHEN 'under_review' THEN 'Documents Under Review'
      WHEN 'needs_information' THEN 'Verification Document Needs Information'
      ELSE 'Verification Document Rejected'
    END;
  ELSE
    v_phase := 'CLIENT ACTION';
    v_status := 'SUBMITTED';
    v_event_title := 'Verification Document Submitted';
    UPDATE public.cases
    SET workflow_phase = 'verification_documents_requested',
        workflow_phase_number = 3,
        workflow_updated_at = now()
    WHERE id = v_case
      AND workflow_phase NOT IN ('documents_under_review','documents_verified','next_client_action','case_review','completed');
  END IF;

  PERFORM public.vf_append_event(
    v_case, v_org, v_event_title,
    CASE p_status
      WHEN 'under_review' THEN 'Your bank-account verification document has been received and is under review.'
      WHEN 'verified' THEN 'Document "' || v_title || '" was verified by ' || public.vf_actor_name(p_actor) ||
                          '. The reviewer confirmed that the receiving-account details on the document match the configured account information.'
      WHEN 'needs_information' THEN 'Document "' || v_title || '" requires additional information.' || COALESCE(' ' || p_note, '')
      WHEN 'rejected' THEN 'Document "' || v_title || '" was rejected.' || COALESCE(' ' || p_note, '')
      ELSE 'Required document "' || v_title || '" was uploaded and is pending review.'
    END,
    v_phase, v_status, p_actor, true,
    v_transfer, v_ref, v_amount, v_currency, NULL, p_req,
    jsonb_build_object('note', p_note, 'document_id', p_document),
    now()
  );
  PERFORM public.vf_log_audit(
    v_org, p_actor, 'requirement_' || lower(p_status), 'transfer_document_requirement', p_req,
    jsonb_build_object('title', v_title, 'status', p_status, 'transfer_id', v_transfer, 'note', p_note, 'document_id', p_document)
  );

  RETURN (SELECT jsonb_build_object('id', id, 'status', status, 'review_note', review_note, 'updated_at', updated_at)
          FROM public.transfer_document_requirements WHERE id = p_req);
END $$;

-- ── 11. PHASE 6 — Next Authorized Client Action ──────────────
-- Gated: cannot be created while any active verification
-- requirement is not VERIFIED, or before the document-verification
-- phase (5) has been reached.
CREATE OR REPLACE FUNCTION public.vf_create_next_client_action(
  p_case uuid, p_org uuid, p_actor uuid,
  p_title text DEFAULT 'Next Authorized Client Action',
  p_description text DEFAULT NULL,
  p_action_url text DEFAULT NULL,
  p_action_label text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL,
  p_is_client_visible boolean DEFAULT true,
  p_active boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pending integer; v_phase_num integer;
  v_action uuid; v_cur_ref text; v_cur_amount numeric; v_cur_currency text;
BEGIN
  SELECT workflow_phase_number INTO v_phase_num FROM public.cases WHERE id = p_case;
  IF v_phase_num IS NULL THEN RAISE EXCEPTION 'case % not found', p_case; END IF;

  SELECT count(*) INTO v_pending
  FROM public.transfer_document_requirements
  WHERE case_id = p_case AND is_active AND status <> 'verified';

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'next authorized client action cannot be created: % active verification requirement(s) are not VERIFIED', v_pending;
  END IF;
  IF v_phase_num < 5 THEN
    RAISE EXCEPTION 'next authorized client action cannot be created: required verification (phase 5) is not complete';
  END IF;

  INSERT INTO public.case_client_actions (
    case_id, organization_id, title, description, action_url, action_label,
    status, is_client_visible, expires_at, activated_at, created_by, metadata
  ) VALUES (
    p_case, p_org, p_title, p_description, p_action_url, p_action_label,
    CASE WHEN p_active THEN 'active' ELSE 'inactive' END, p_is_client_visible, p_expires_at, now(), p_actor,
    jsonb_build_object('phase', 'next_client_action', 'phase_number', 6)
  ) RETURNING id INTO v_action;

  SELECT t.transfer_reference, t.amount, t.currency INTO v_cur_ref, v_cur_amount, v_cur_currency
  FROM public.case_transfers t
  JOIN public.cases c ON c.current_transfer_id = t.id
  WHERE c.id = p_case;

  UPDATE public.cases
  SET workflow_phase = 'next_client_action',
      workflow_phase_number = 6,
      workflow_updated_at = now()
  WHERE id = p_case;

  PERFORM public.vf_append_event(
    p_case, p_org, p_title,
    COALESCE(p_description, 'The required verification has been completed. The next authorized client action is now available.'),
    'PHASE 6', CASE WHEN p_active THEN 'ACTIVE' ELSE 'INACTIVE' END, p_actor, p_is_client_visible,
    NULL, v_cur_ref, v_cur_amount, v_cur_currency, NULL, NULL,
    jsonb_build_object('action_id', v_action, 'action_url', p_action_url, 'action_label', p_action_label, 'expires_at', p_expires_at, 'visibility', CASE WHEN p_is_client_visible THEN 'client' ELSE 'admin' END),
    now()
  );
  PERFORM public.vf_log_audit(
    p_org, p_actor, 'next_client_action_created', 'case_client_action', v_action,
    jsonb_build_object('title', p_title, 'action_url', p_action_url, 'action_label', p_action_label, 'expires_at', p_expires_at, 'active', p_active)
  );

  RETURN (SELECT jsonb_build_object('id', id, 'case_id', case_id, 'title', title, 'description', description, 'action_url', action_url, 'action_label', action_label, 'status', status, 'is_client_visible', is_client_visible, 'expires_at', expires_at, 'activated_at', activated_at, 'created_by', created_by) FROM public.case_client_actions WHERE id = v_action);
END $$;

-- ── 12. Generic phase advance (kept consistent with the new 6-phase names) ──
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

  IF v_phase = 'next_client_action' THEN
    RAISE EXCEPTION 'case workflow already at final phase (next_client_action)';
  END IF;

  v_next_num := v_num + 1;
  v_next := CASE v_next_num
    WHEN 2 THEN 'receiving_bank_review'::public.workflow_phase
    WHEN 3 THEN 'verification_documents_requested'::public.workflow_phase
    WHEN 4 THEN 'documents_under_review'::public.workflow_phase
    WHEN 5 THEN 'documents_verified'::public.workflow_phase
    WHEN 6 THEN 'next_client_action'::public.workflow_phase
    ELSE 'next_client_action'::public.workflow_phase
  END;

  UPDATE public.cases
  SET workflow_phase = v_next,
      workflow_phase_number = v_next_num,
      workflow_updated_at = now()
  WHERE id = p_case;

  PERFORM public.vf_append_event(
    p_case, v_org, 'Workflow Advanced',
    'Case workflow advanced from phase ' || v_num || ' (' || v_phase || ') to phase ' ||
    v_next_num || ' (' || v_next || ').' || COALESCE(' ' || p_note, ''),
    'PHASE ' || v_next_num, NULL, p_actor, true,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, now()
  );
  PERFORM public.vf_log_audit(
    v_org, p_actor, 'case_phase_advanced', 'case', p_case,
    jsonb_build_object('from_phase', v_phase::text, 'to_phase', v_next::text, 'from_number', v_num, 'to_number', v_next_num, 'note', p_note)
  );

  RETURN jsonb_build_object('case_id', p_case, 'from_phase', v_phase, 'to_phase', v_next, 'from_number', v_num, 'to_number', v_next_num);
END $$;

-- ── 13. Read models ──────────────────────────────────────────
-- vf_get_case_timeline: chronological case events with full fields.
DROP FUNCTION IF EXISTS public.vf_get_case_timeline(uuid);
CREATE OR REPLACE FUNCTION public.vf_get_case_timeline(p_case uuid, p_view text DEFAULT 'admin')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb; v_case_number text;
BEGIN
  SELECT case_number INTO v_case_number FROM public.cases WHERE id = p_case;
  IF v_case_number IS NULL THEN RAISE EXCEPTION 'case % not found', p_case; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', e.id, 'case_id', e.case_id, 'case_number', v_case_number,
    'phase', e.phase, 'title', e.title, 'status', e.status,
    'description', e.description, 'event_date', e.event_date,
    'actor_id', e.actor_id, 'actor_name', e.actor_name,
    'is_client_visible', e.is_client_visible,
    'transfer_id', e.transfer_id, 'transfer_reference', e.transfer_reference,
    'amount', e.amount, 'currency', e.currency,
    'document_id', e.document_id, 'requirement_id', e.requirement_id,
    'metadata', e.metadata
  ) ORDER BY e.event_date, e.created_at)
  INTO v_result
  FROM public.timeline e
  WHERE e.case_id = p_case
    AND (lower(p_view) <> 'client' OR e.is_client_visible);

  RETURN COALESCE(v_result, '[]'::jsonb);
END $$;

-- vf_get_case_workflow: read-only workflow state for a case.
-- view = 'admin' (complete audit) | 'client' (client-visible only, masked).
DROP FUNCTION IF EXISTS public.vf_get_case_workflow(uuid);
CREATE OR REPLACE FUNCTION public.vf_get_case_workflow(p_case uuid, p_view text DEFAULT 'admin')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb; v_client boolean := (lower(p_view) = 'client');
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
        'receiving_account_number', CASE WHEN v_client THEN public.vf_mask_account(t.receiving_account_number) ELSE t.receiving_account_number END,
        'receiving_institution_routing_number', CASE WHEN v_client THEN public.vf_mask_account(t.receiving_institution_routing_number) ELSE t.receiving_institution_routing_number END,
        'receiving_details_verified', t.receiving_details_verified,
        'receiving_details_verification_note', CASE WHEN v_client THEN NULL ELSE t.receiving_details_verification_note END,
        'acceptance_verified', t.acceptance_verified,
        'execution_confirmed', t.execution_confirmed,
        'execution_confirmation_reference', CASE WHEN v_client THEN NULL ELSE t.execution_confirmation_reference END,
        'executed_at', t.executed_at
      ) ORDER BY t.prepared_at)
      FROM public.case_transfers t WHERE t.case_id = c.id
    ), '[]'::jsonb),
    'requirements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'requirement_key', r.requirement_key, 'title', r.title,
        'category', r.category, 'status', r.status, 'transfer_id', r.transfer_id,
        'is_client_visible', r.is_client_visible,
        'submitted_document_id', r.submitted_document_id,
        'submitted_at', r.submitted_at, 'submitted_by', r.submitted_by,
        'reviewed_at', r.reviewed_at, 'reviewed_by', r.reviewed_by,
        'review_note', CASE WHEN v_client THEN NULL ELSE r.review_note END,
        'document', (SELECT jsonb_build_object('id', d.id, 'title', d.title, 'file_name', d.file_name, 'file_size', d.file_size, 'mime_type', d.mime_type, 'document_status', d.document_status, 'uploaded_at', d.uploaded_at, 'uploaded_by', d.uploaded_by) FROM public.documents d WHERE d.id = r.submitted_document_id)
      ) ORDER BY r.sort_order, r.created_at)
      FROM public.transfer_document_requirements r
      WHERE r.case_id = c.id AND r.is_active AND (NOT v_client OR r.is_client_visible)
    ), '[]'::jsonb),
    'timeline', public.vf_get_case_timeline(c.id, p_view),
    'documents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'case_id', d.case_id, 'title', d.title, 'description', CASE WHEN v_client THEN NULL ELSE d.description END,
        'document_type', d.document_type, 'mime_type', d.mime_type, 'file_name', d.file_name,
        'file_size', d.file_size, 'document_status', d.document_status,
        'uploaded_by', d.uploaded_by, 'uploaded_at', d.uploaded_at
      ) ORDER BY d.uploaded_at)
      FROM public.documents d WHERE d.case_id = c.id AND (NOT v_client OR d.is_client_visible)
    ), '[]'::jsonb),
    'client_actions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'case_id', a.case_id, 'title', a.title, 'description', a.description,
        'action_url', a.action_url, 'action_label', a.action_label,
        'status', a.status, 'is_client_visible', a.is_client_visible,
        'expires_at', a.expires_at, 'activated_at', a.activated_at
      ) ORDER BY a.activated_at)
      FROM public.case_client_actions a WHERE a.case_id = c.id AND (NOT v_client OR a.is_client_visible)
    ), '[]'::jsonb),
    'audit', CASE WHEN v_client THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'resource_type', a.resource_type, 'resource_id', a.resource_id, 'user_id', a.user_id, 'changes', a.changes, 'created_at', a.created_at) ORDER BY a.created_at)
      FROM public.audit_logs a
      WHERE EXISTS (
        SELECT 1 FROM public.cases cc WHERE cc.id = c.id AND (
          a.resource_id = cc.id
          OR a.resource_id IN (SELECT t.id FROM public.case_transfers t WHERE t.case_id = cc.id)
          OR a.resource_id IN (SELECT r.id FROM public.transfer_document_requirements r WHERE r.case_id = cc.id)
          OR a.resource_id IN (SELECT d.id FROM public.documents d WHERE d.case_id = cc.id)
          OR a.resource_id IN (SELECT ca.id FROM public.case_client_actions ca WHERE ca.case_id = cc.id)
        )
      )
    ), '[]'::jsonb) END
  ) INTO v_result
  FROM public.cases c WHERE c.id = p_case;

  IF v_result IS NULL THEN RAISE EXCEPTION 'case % not found', p_case; END IF;
  RETURN v_result;
END $$;

-- ── 14. Grants ───────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.vf_actor_name(uuid) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_mask_account(text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_append_event(uuid, uuid, text, text, text, text, uuid, boolean, uuid, text, numeric, text, uuid, uuid, jsonb, timestamptz) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_create_transfer(uuid, uuid, text, numeric, text, text, text, text, text, text, text, text, text, text, uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_submit_transfer_for_review(uuid, uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_add_requirement(uuid, uuid, text, text, text, text, uuid, integer, uuid) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_upload_verification_document(uuid, uuid, text, text, text, text, bigint, text, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_set_requirement_status(uuid, text, uuid, text, uuid) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_create_next_client_action(uuid, uuid, uuid, text, text, text, text, timestamptz, boolean, boolean) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_advance_case_phase(uuid, uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_case_timeline(uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_case_workflow(uuid, text) TO vineford_app;

COMMIT;
