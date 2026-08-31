-- ============================================================
-- 0014 — POST-VERIFICATION CLIENT ACTION: WITHDRAWAL REQUESTS
-- Target DB : vineford_intake_test
--
-- Completes the Phase 6 client-action workflow on top of the
-- existing Phase 1–6 flow and the Phase 6 authorization handoff
-- (0013). Everything is SANDBOX / DEMO: requesting, approving or
-- rejecting a withdrawal NEVER executes a real financial transfer,
-- never touches the ledger / payments / treasury, and never moves
-- real funds.
--
-- What this migration adds (non-destructive, additive only):
--   * public.case_withdrawal_requests        — the withdrawal request
--     record (status lifecycle:
--     pending_review -> approved | rejected | needs_information,
--     needs_information -> pending_review on client response).
--   * vf_withdrawal_status_label             — single source of truth
--     for client-facing status copy.
--   * vf_submit_withdrawal_request           — CLIENT ACTION. Gated on
--     the case being actually approved (Phase 5 VERIFIED), no pending
--     verification requirements, an active client action, AND an
--     active, unexpired Phase 6 handoff grant whose token matches.
--     Status is ALWAYS 'pending_review' on creation.
--   * vf_admin_withdrawal_decision           — ADMIN APPROVE / REJECT /
--     REQUEST MORE INFORMATION. Approving never executes a transfer
--     (executed = false, sandbox = true).
--   * vf_respond_to_withdrawal_request       — CLIENT RESPONSE to a
--     more-information request (returns status to pending_review).
--   * vf_get_withdrawal_request /
--     vf_get_case_withdrawal_requests / vf_list_withdrawal_requests —
--     read models. Client view masks banking details; actor checks.
--   * vf_send_case_message / vf_get_case_messages — reuses the EXISTING
--     public.messages table (case-scoped secure messaging); no second
--     messaging architecture is created.
--   * Automation events reuse the existing framework: every transition
--     emits timeline events (via vf_append_event) and immutable audit
--     rows (via vf_log_audit): submitted, requires review, approved,
--     rejected, more information requested, client response received.
--   * vf_get_case_workflow is redefined additively to expose
--     'withdrawal_requests' and 'messages'.
--
-- The existing VF-2026-8282 historical data (documents, evidence,
-- messages, invoices, payments, timeline, audit, transfers, client
-- actions, handoff grants) is preserved — no table is dropped or
-- truncated, no unconditional DELETE, no ALTER of existing columns.
-- Run as: postgres superuser.
-- ============================================================

BEGIN;

-- ── 1. case_withdrawal_requests ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.case_withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  client_actor_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'USD',
  requested_method text,
  beneficiary_name text,
  account_number text,
  account_type text,
  routing_number text,
  client_note text,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','needs_information','approved','rejected')),
  admin_note text,
  admin_reason text,
  review_message text,
  approved_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  info_requested_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  info_requested_at timestamptz,
  client_response text,
  responded_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  responded_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_case_id ON public.case_withdrawal_requests(case_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status  ON public.case_withdrawal_requests(status);

ALTER TABLE public.case_withdrawal_requests OWNER TO vineford_app;

DROP TRIGGER IF EXISTS trigger_update_case_withdrawal_requests_updated_at ON public.case_withdrawal_requests;
CREATE TRIGGER trigger_update_case_withdrawal_requests_updated_at
BEFORE UPDATE ON public.case_withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 2. Client-facing status labels ───────────────────────────
CREATE OR REPLACE FUNCTION public.vf_withdrawal_status_label(p_status text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  RETURN CASE p_status
    WHEN 'pending_review' THEN jsonb_build_object(
      'label', 'PENDING REVIEW',
      'message', 'Your withdrawal request has been submitted and is awaiting review. This is a SANDBOX / DEMO request — no real funds are involved.')
    WHEN 'needs_information' THEN jsonb_build_object(
      'label', 'MORE INFORMATION REQUIRED',
      'message', 'An administrator requested more information about your withdrawal request. Please review their message and respond.')
    WHEN 'approved' THEN jsonb_build_object(
      'label', 'APPROVED',
      'message', 'Your withdrawal request has been approved. SANDBOX / DEMO only — no real funds were transferred and none will be transferred automatically.')
    WHEN 'rejected' THEN jsonb_build_object(
      'label', 'REJECTED',
      'message', 'Your withdrawal request was declined. Contact the case administrator for details.')
    ELSE jsonb_build_object('label', upper(replace(coalesce(p_status, ''), '_', ' ')), 'message', '')
  END;
END $$;

-- ── 3. Shared actor authorization helpers ────────────────────
-- vf_actor_can_access_case: admin (super_admin/admin) OR an actor that
-- is the case's client (same email as the case client) in the same org.
CREATE OR REPLACE FUNCTION public.vf_actor_can_access_case(p_actor uuid, p_case uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role public.user_role; v_org uuid; v_case_org uuid;
BEGIN
  IF p_actor IS NULL THEN RETURN false; END IF;
  SELECT role, organization_id INTO v_role, v_org FROM public.app_users WHERE id = p_actor;
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role IN ('super_admin','admin') THEN RETURN true; END IF;
  SELECT organization_id INTO v_case_org FROM public.cases WHERE id = p_case;
  IF v_org IS DISTINCT FROM v_case_org THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.app_users u
    JOIN public.cases c ON c.id = p_case
    JOIN public.clients cl ON cl.id = c.client_id
    WHERE u.id = p_actor AND lower(u.email) = lower(cl.email)
  );
END $$;

-- ── 4. Submit — CLIENT ACTION (Phase 6, authorization-gated) ─
CREATE OR REPLACE FUNCTION public.vf_submit_withdrawal_request(
  p_case uuid, p_actor uuid, p_handoff_token text,
  p_amount numeric, p_currency text DEFAULT 'USD',
  p_method text DEFAULT NULL, p_beneficiary text DEFAULT NULL,
  p_account text DEFAULT NULL, p_account_type text DEFAULT NULL,
  p_routing text DEFAULT NULL, p_client_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_case_number text; v_client_id uuid; v_phase public.workflow_phase;
  v_pending integer; v_grant public.case_handoff_grants%ROWTYPE; v_id uuid;
BEGIN
  SELECT organization_id, case_number, client_id, workflow_phase
    INTO v_org, v_case_number, v_client_id, v_phase
  FROM public.cases WHERE id = p_case;
  IF v_org IS NULL THEN RAISE EXCEPTION 'case % not found', p_case; END IF;

  -- Actor authorization (client of the case or administrator).
  IF NOT public.vf_actor_can_access_case(p_actor, p_case) THEN
    RAISE EXCEPTION 'permission denied: only the case client or an administrator may request a withdrawal (actor %)', p_actor;
  END IF;

  -- Revalidate live approval state (Phase 6 gate).
  IF v_phase NOT IN ('documents_verified','next_client_action') THEN
    RAISE EXCEPTION 'withdrawal request cannot be submitted: case is not approved (current phase: %)', v_phase;
  END IF;
  SELECT count(*) INTO v_pending
  FROM public.transfer_document_requirements
  WHERE case_id = p_case AND is_active AND status <> 'verified';
  IF v_pending > 0 THEN
    RAISE EXCEPTION 'withdrawal request cannot be submitted: % active verification requirement(s) are not VERIFIED', v_pending;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.case_client_actions
    WHERE case_id = p_case AND status = 'active' AND is_client_visible
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RAISE EXCEPTION 'withdrawal request cannot be submitted: no active authorized client action';
  END IF;

  -- Authorization handoff: active, unexpired grant whose token matches.
  SELECT * INTO v_grant FROM public.case_handoff_grants
  WHERE case_id = p_case AND purpose = 'phase6_handoff' AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY issued_at DESC LIMIT 1;
  IF v_grant.id IS NULL THEN
    RAISE EXCEPTION 'phase 6 withdrawal authorization required: no active handoff grant for case %', p_case;
  END IF;
  IF p_handoff_token IS NULL OR btrim(p_handoff_token) = '' OR v_grant.token IS NULL
     OR v_grant.token IS DISTINCT FROM p_handoff_token THEN
    RAISE EXCEPTION 'invalid or expired phase 6 handoff token';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'withdrawal amount must be greater than zero';
  END IF;

  INSERT INTO public.case_withdrawal_requests (
    case_id, organization_id, client_id, client_actor_id,
    amount, currency, requested_method, beneficiary_name,
    account_number, account_type, routing_number, client_note,
    status, metadata
  ) VALUES (
    p_case, v_org, v_client_id, p_actor,
    p_amount, COALESCE(p_currency, 'USD'), p_method, p_beneficiary,
    p_account, p_account_type, p_routing, p_client_note,
    'pending_review',
    jsonb_build_object(
      'sandbox', true, 'simulated', true, 'grant_id', v_grant.id,
      'phase', 'next_client_action', 'phase_number', 6
    )
  ) RETURNING id INTO v_id;

  PERFORM public.vf_append_event(
    p_case, v_org,
    'Withdrawal Request Submitted',
    'A withdrawal request for ' || COALESCE(p_currency, 'USD') || ' ' || p_amount ||
    ' was submitted for case ' || v_case_number || '. This is a SANDBOX / DEMO request — no real funds, transfers, withdrawals, settlements or balances are represented.',
    'PHASE 6', 'WITHDRAWAL_REQUEST_SUBMITTED', p_actor, true,
    NULL, NULL, p_amount, COALESCE(p_currency, 'USD'), NULL, NULL,
    jsonb_build_object('withdrawal_request_id', v_id, 'status', 'pending_review', 'sandbox', true, 'simulated', true),
    now()
  );
  PERFORM public.vf_append_event(
    p_case, v_org,
    'Withdrawal Request Requires Review',
    'The withdrawal request for case ' || v_case_number || ' requires administrator review.',
    'PHASE 6', 'WITHDRAWAL_REQUEST_REQUIRES_REVIEW', p_actor, false,
    NULL, NULL, p_amount, COALESCE(p_currency, 'USD'), NULL, NULL,
    jsonb_build_object('withdrawal_request_id', v_id, 'sandbox', true),
    now()
  );
  PERFORM public.vf_log_audit(
    v_org, p_actor, 'withdrawal_request_submitted', 'case_withdrawal_request', v_id,
    jsonb_build_object('case_id', p_case, 'amount', p_amount, 'currency', COALESCE(p_currency, 'USD'),
                       'status', 'pending_review', 'sandbox', true, 'simulated', true)
  );

  RETURN jsonb_build_object(
    'id', v_id, 'case_id', p_case, 'case_number', v_case_number,
    'organization_id', v_org, 'amount', p_amount, 'currency', COALESCE(p_currency, 'USD'),
    'requested_method', p_method, 'beneficiary_name', p_beneficiary,
    'account_number', public.vf_mask_account(p_account),
    'account_type', p_account_type, 'routing_number', public.vf_mask_account(p_routing),
    'status', 'pending_review',
    'client_status', public.vf_withdrawal_status_label('pending_review'),
    'created_at', now(),
    'sandbox', true, 'simulated', true,
    'disclaimer', 'SANDBOX / DEMO workflow. This is simulated functionality only — no real funds, transfers, withdrawals, settlements or balances are represented.'
  );
END $$;

-- ── 5. Read models ───────────────────────────────────────────
-- Detail. p_actor (optional) enables an authorization check; when
-- NULL (e.g. embedded in the workflow read model) the caller relies
-- on the surrounding access control and the view still masks banking.
CREATE OR REPLACE FUNCTION public.vf_get_withdrawal_request(
  p_request uuid, p_actor uuid DEFAULT NULL, p_view text DEFAULT 'admin'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client boolean := (lower(p_view) = 'client'); v_res jsonb; v_case uuid;
BEGIN
  SELECT case_id INTO v_case FROM public.case_withdrawal_requests WHERE id = p_request;
  IF v_case IS NULL THEN RAISE EXCEPTION 'withdrawal request % not found', p_request; END IF;
  IF p_actor IS NOT NULL AND NOT public.vf_actor_can_access_case(p_actor, v_case) THEN
    RAISE EXCEPTION 'permission denied: actor % is not authorized for this withdrawal request', p_actor;
  END IF;

  SELECT jsonb_build_object(
    'id', wr.id, 'case_id', wr.case_id, 'case_number', c.case_number,
    'workflow_phase', c.workflow_phase, 'client_name', cl.name,
    'amount', wr.amount, 'currency', wr.currency,
    'requested_method', wr.requested_method,
    'beneficiary_name', CASE WHEN v_client THEN NULL ELSE wr.beneficiary_name END,
    'account_number', CASE WHEN v_client THEN public.vf_mask_account(wr.account_number) ELSE wr.account_number END,
    'account_type', CASE WHEN v_client THEN NULL ELSE wr.account_type END,
    'routing_number', CASE WHEN v_client THEN NULL ELSE public.vf_mask_account(wr.routing_number) END,
    'client_note', wr.client_note,
    'status', wr.status,
    'client_status', public.vf_withdrawal_status_label(wr.status),
    'admin_reason', CASE WHEN v_client THEN NULL ELSE wr.admin_reason END,
    'review_message', CASE WHEN v_client AND wr.status <> 'needs_information' THEN NULL ELSE wr.review_message END,
    'admin_note', CASE WHEN v_client THEN NULL ELSE wr.admin_note END,
    'approved_by', CASE WHEN v_client THEN NULL ELSE wr.approved_by END,
    'approved_by_name', CASE WHEN v_client THEN NULL ELSE au_a.name END,
    'approved_at', wr.approved_at,
    'rejected_by', CASE WHEN v_client THEN NULL ELSE wr.rejected_by END,
    'rejected_by_name', CASE WHEN v_client THEN NULL ELSE au_r.name END,
    'rejected_at', wr.rejected_at,
    'info_requested_by', CASE WHEN v_client THEN NULL ELSE wr.info_requested_by END,
    'info_requested_at', wr.info_requested_at,
    'client_response', wr.client_response,
    'responded_by', CASE WHEN v_client THEN NULL ELSE wr.responded_by END,
    'responded_at', wr.responded_at,
    'created_at', wr.created_at, 'updated_at', wr.updated_at,
    'sandbox', true, 'simulated', true,
    'disclaimer', 'SANDBOX / DEMO workflow. This is simulated functionality only — no real funds, transfers, withdrawals, settlements or balances are represented.'
  ) INTO v_res
  FROM public.case_withdrawal_requests wr
  JOIN public.cases c ON c.id = wr.case_id
  LEFT JOIN public.clients cl ON cl.id = wr.client_id
  LEFT JOIN public.app_users au_a ON au_a.id = wr.approved_by
  LEFT JOIN public.app_users au_r ON au_r.id = wr.rejected_by
  WHERE wr.id = p_request;

  RETURN v_res;
END $$;

-- Case-scoped list. p_actor (optional) enforces authorization.
CREATE OR REPLACE FUNCTION public.vf_get_case_withdrawal_requests(
  p_case uuid, p_actor uuid DEFAULT NULL, p_view text DEFAULT 'admin'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_res jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cases WHERE id = p_case) THEN
    RAISE EXCEPTION 'case % not found', p_case;
  END IF;
  IF p_actor IS NOT NULL AND NOT public.vf_actor_can_access_case(p_actor, p_case) THEN
    RAISE EXCEPTION 'permission denied: actor % is not authorized for case %', p_actor, p_case;
  END IF;
  SELECT COALESCE(jsonb_agg(public.vf_get_withdrawal_request(wr.id, NULL, p_view) ORDER BY wr.created_at), '[]'::jsonb)
    INTO v_res
  FROM public.case_withdrawal_requests wr WHERE wr.case_id = p_case;
  RETURN v_res;
END $$;

-- Admin review queue ("control room"): all requests with case reference,
-- client, amount, request date, status and relevant workflow state.
CREATE OR REPLACE FUNCTION public.vf_list_withdrawal_requests(
  p_actor uuid, p_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role public.user_role; v_org uuid; v_res jsonb;
BEGIN
  PERFORM public.vf_require_admin(p_actor);
  SELECT role, organization_id INTO v_role, v_org FROM public.app_users WHERE id = p_actor;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', wr.id, 'case_id', wr.case_id, 'case_number', c.case_number,
    'client_name', cl.name, 'client_email', cl.email,
    'amount', wr.amount, 'currency', wr.currency,
    'status', wr.status, 'client_status', public.vf_withdrawal_status_label(wr.status),
    'request_date', wr.created_at, 'updated_at', wr.updated_at,
    'workflow_phase', c.workflow_phase,
    'action_label', (SELECT a.action_label FROM public.case_client_actions a
                     WHERE a.case_id = c.id AND a.status = 'active'
                     ORDER BY a.activated_at DESC LIMIT 1),
    'sandbox', true, 'simulated', true
  ) ORDER BY wr.created_at DESC), '[]'::jsonb) INTO v_res
  FROM public.case_withdrawal_requests wr
  JOIN public.cases c ON c.id = wr.case_id
  LEFT JOIN public.clients cl ON cl.id = wr.client_id
  WHERE (p_status IS NULL OR wr.status = p_status)
    AND (v_role = 'super_admin' OR wr.organization_id = v_org);
  RETURN v_res;
END $$;

-- ── 6. ADMIN DECISION — approve / reject / more information ──
CREATE OR REPLACE FUNCTION public.vf_admin_withdrawal_decision(
  p_request uuid, p_decision text, p_actor uuid,
  p_reason text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.case_withdrawal_requests%ROWTYPE;
  v_org uuid; v_case uuid; v_case_number text; v_phase public.workflow_phase;
  v_pending integer; v_status text;
BEGIN
  PERFORM public.vf_require_admin(p_actor);
  SELECT * INTO v_row FROM public.case_withdrawal_requests WHERE id = p_request;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'withdrawal request % not found', p_request; END IF;
  SELECT organization_id, case_number, workflow_phase
    INTO v_org, v_case_number, v_phase
  FROM public.cases WHERE id = v_row.case_id;
  v_case := v_row.case_id;

  IF p_decision = 'approve' THEN
    -- Revalidate live approval before approving a Phase 6 withdrawal.
    IF v_phase NOT IN ('documents_verified','next_client_action') THEN
      RAISE EXCEPTION 'withdrawal request cannot be approved: case is not approved (current phase: %)', v_phase;
    END IF;
    SELECT count(*) INTO v_pending
    FROM public.transfer_document_requirements
    WHERE case_id = v_case AND is_active AND status <> 'verified';
    IF v_pending > 0 THEN
      RAISE EXCEPTION 'withdrawal request cannot be approved: % active verification requirement(s) are not VERIFIED', v_pending;
    END IF;
    v_status := 'approved';
    UPDATE public.case_withdrawal_requests
    SET status = 'approved', approved_by = p_actor, approved_at = now(), admin_note = p_note, updated_at = now()
    WHERE id = p_request;
    PERFORM public.vf_append_event(
      v_case, v_org,
      'Withdrawal Request Approved',
      'The withdrawal request for case ' || v_case_number || ' was approved. SANDBOX / DEMO only — no real financial transfer was executed.',
      'PHASE 6', 'WITHDRAWAL_REQUEST_APPROVED', p_actor, true,
      NULL, NULL, v_row.amount, v_row.currency, NULL, NULL,
      jsonb_build_object('withdrawal_request_id', p_request, 'executed', false, 'sandbox', true, 'simulated', true),
      now()
    );
    PERFORM public.vf_log_audit(
      v_org, p_actor, 'withdrawal_request_approved', 'case_withdrawal_request', p_request,
      jsonb_build_object('decision', 'approve', 'note', p_note, 'executed', false, 'sandbox', true, 'simulated', true)
    );
  ELSIF p_decision = 'reject' THEN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
      RAISE EXCEPTION 'a reason is required to reject a withdrawal request';
    END IF;
    v_status := 'rejected';
    UPDATE public.case_withdrawal_requests
    SET status = 'rejected', rejected_by = p_actor, rejected_at = now(),
        admin_reason = p_reason, admin_note = p_note, updated_at = now()
    WHERE id = p_request;
    PERFORM public.vf_append_event(
      v_case, v_org,
      'Withdrawal Request Rejected',
      'The withdrawal request for case ' || v_case_number || ' was rejected: ' || p_reason,
      'PHASE 6', 'WITHDRAWAL_REQUEST_REJECTED', p_actor, true,
      NULL, NULL, v_row.amount, v_row.currency, NULL, NULL,
      jsonb_build_object('withdrawal_request_id', p_request, 'reason', p_reason, 'sandbox', true),
      now()
    );
    PERFORM public.vf_log_audit(
      v_org, p_actor, 'withdrawal_request_rejected', 'case_withdrawal_request', p_request,
      jsonb_build_object('decision', 'reject', 'reason', p_reason, 'note', p_note, 'sandbox', true)
    );
  ELSIF p_decision = 'needs_information' THEN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
      RAISE EXCEPTION 'a message to the client is required when requesting more information';
    END IF;
    v_status := 'needs_information';
    UPDATE public.case_withdrawal_requests
    SET status = 'needs_information', info_requested_by = p_actor, info_requested_at = now(),
        review_message = p_reason, admin_note = p_note, updated_at = now()
    WHERE id = p_request;
    PERFORM public.vf_append_event(
      v_case, v_org,
      'More Information Requested',
      'An administrator requested more information about the withdrawal request for case ' || v_case_number || '.',
      'PHASE 6', 'MORE_INFORMATION_REQUESTED', p_actor, true,
      NULL, NULL, v_row.amount, v_row.currency, NULL, NULL,
      jsonb_build_object('withdrawal_request_id', p_request, 'message', p_reason, 'sandbox', true),
      now()
    );
    PERFORM public.vf_log_audit(
      v_org, p_actor, 'withdrawal_request_info_requested', 'case_withdrawal_request', p_request,
      jsonb_build_object('decision', 'needs_information', 'message', p_reason, 'note', p_note, 'sandbox', true)
    );
  ELSE
    RAISE EXCEPTION 'invalid withdrawal decision: % (expected approve, reject or needs_information)', p_decision;
  END IF;

  RETURN public.vf_get_withdrawal_request(p_request, p_actor, 'admin')
         || jsonb_build_object(
              'decision', p_decision,
              'executed', CASE WHEN p_decision = 'approve' THEN false ELSE NULL END,
              'sandbox', true, 'simulated', true,
              'disclaimer', 'SANDBOX / DEMO workflow. No real financial transfer was executed and none will be executed automatically.'
            );
END $$;

-- ── 7. CLIENT RESPONSE to more-information request ───────────
CREATE OR REPLACE FUNCTION public.vf_respond_to_withdrawal_request(
  p_request uuid, p_actor uuid, p_response text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.case_withdrawal_requests%ROWTYPE; v_org uuid; v_case_number text;
BEGIN
  SELECT * INTO v_row FROM public.case_withdrawal_requests WHERE id = p_request;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'withdrawal request % not found', p_request; END IF;
  IF NOT public.vf_actor_can_access_case(p_actor, v_row.case_id) THEN
    RAISE EXCEPTION 'permission denied: only the case client or an administrator may respond (actor %)', p_actor;
  END IF;
  IF v_row.status <> 'needs_information' THEN
    RAISE EXCEPTION 'withdrawal request % is not awaiting a client response (status: %)', p_request, v_row.status;
  END IF;
  IF p_response IS NULL OR btrim(p_response) = '' THEN
    RAISE EXCEPTION 'a response is required';
  END IF;

  UPDATE public.case_withdrawal_requests
  SET status = 'pending_review', client_response = p_response,
      responded_by = p_actor, responded_at = now(), updated_at = now()
  WHERE id = p_request;

  SELECT organization_id, case_number INTO v_org, v_case_number FROM public.cases WHERE id = v_row.case_id;
  PERFORM public.vf_append_event(
    v_row.case_id, v_org,
    'Client Response Received',
    'The client responded to the more-information request for the withdrawal on case ' || v_case_number ||
    '. The withdrawal request is back under review. SANDBOX / DEMO — no real funds are involved.',
    'PHASE 6', 'CLIENT_RESPONSE_RECEIVED', p_actor, true,
    NULL, NULL, v_row.amount, v_row.currency, NULL, NULL,
    jsonb_build_object('withdrawal_request_id', p_request, 'status', 'pending_review', 'sandbox', true),
    now()
  );
  PERFORM public.vf_log_audit(
    v_org, p_actor, 'withdrawal_request_responded', 'case_withdrawal_request', p_request,
    jsonb_build_object('status', 'pending_review', 'sandbox', true)
  );

  RETURN public.vf_get_withdrawal_request(p_request, p_actor, 'admin');
END $$;

-- ── 8. Secure case messaging (reuses existing public.messages) ─
CREATE OR REPLACE FUNCTION public.vf_send_case_message(
  p_case uuid, p_actor uuid, p_content text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_id uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.cases WHERE id = p_case;
  IF v_org IS NULL THEN RAISE EXCEPTION 'case % not found', p_case; END IF;
  IF NOT public.vf_actor_can_access_case(p_actor, p_case) THEN
    RAISE EXCEPTION 'permission denied: actor % is not authorized to message on case %', p_actor, p_case;
  END IF;
  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'message content cannot be empty';
  END IF;

  INSERT INTO public.messages (case_id, organization_id, sender_id, content)
  VALUES (p_case, v_org, p_actor, btrim(p_content))
  RETURNING id INTO v_id;

  PERFORM public.vf_log_audit(
    v_org, p_actor, 'case_message_sent', 'message', v_id,
    jsonb_build_object('case_id', p_case, 'content_preview', left(btrim(p_content), 120), 'sandbox', true)
  );

  RETURN jsonb_build_object(
    'id', v_id, 'case_id', p_case,
    'sender_id', p_actor,
    'sender_name', (SELECT name FROM public.app_users WHERE id = p_actor),
    'sender_role', (SELECT role FROM public.app_users WHERE id = p_actor),
    'content', btrim(p_content),
    'created_at', now(),
    'sandbox', true, 'simulated', true
  );
END $$;

CREATE OR REPLACE FUNCTION public.vf_get_case_messages(
  p_case uuid, p_actor uuid DEFAULT NULL, p_view text DEFAULT 'admin'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_res jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cases WHERE id = p_case) THEN
    RAISE EXCEPTION 'case % not found', p_case;
  END IF;
  IF p_actor IS NOT NULL AND NOT public.vf_actor_can_access_case(p_actor, p_case) THEN
    RAISE EXCEPTION 'permission denied: actor % is not authorized for case %', p_actor, p_case;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', m.id, 'case_id', m.case_id,
    'sender_id', m.sender_id, 'sender_name', u.name, 'sender_role', u.role,
    'content', m.content, 'created_at', m.created_at
  ) ORDER BY m.created_at), '[]'::jsonb) INTO v_res
  FROM public.messages m
  LEFT JOIN public.app_users u ON u.id = m.sender_id
  WHERE m.case_id = p_case;
  RETURN v_res;
END $$;

-- ── 9. Expose withdrawals + messages in the workflow read model ─
DROP FUNCTION IF EXISTS public.vf_get_case_workflow(uuid, text);
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
        'client_status', public.vf_requirement_status_label(r.status),
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
    'phase6_handoff', public.vf_get_phase6_handoff_status(c.id, p_view),
    'withdrawal_requests', public.vf_get_case_withdrawal_requests(c.id, NULL, p_view),
    'messages', public.vf_get_case_messages(c.id, NULL, p_view),
    'payment_gate', CASE WHEN v_client THEN public.vf_get_payment_gate_public(c.id) ELSE public.vf_get_payment_gate() END,
    'case_payment', public.vf_get_case_payment(c.id, p_view),
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
          OR a.resource_id IN (SELECT cp.id FROM public.case_payments cp WHERE cp.case_id = cc.id)
          OR a.resource_id IN (SELECT hg.id FROM public.case_handoff_grants hg WHERE hg.case_id = cc.id)
          OR a.resource_id IN (SELECT wr.id FROM public.case_withdrawal_requests wr WHERE wr.case_id = cc.id)
        )
      )
    ), '[]'::jsonb) END
  ) INTO v_result
  FROM public.cases c WHERE c.id = p_case;

  IF v_result IS NULL THEN RAISE EXCEPTION 'case % not found', p_case; END IF;
  RETURN v_result;
END $$;

-- ── 10. Grants ───────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.vf_withdrawal_status_label(text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_actor_can_access_case(uuid, uuid) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_submit_withdrawal_request(uuid, uuid, text, numeric, text, text, text, text, text, text, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_withdrawal_request(uuid, uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_case_withdrawal_requests(uuid, uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_list_withdrawal_requests(uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_admin_withdrawal_decision(uuid, text, uuid, text, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_respond_to_withdrawal_request(uuid, uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_send_case_message(uuid, uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_case_messages(uuid, uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_case_workflow(uuid, text) TO vineford_app;

COMMIT;
