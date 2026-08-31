-- ============================================================
-- 0013 — PHASE 6 AUTHORIZATION-BASED HANDOFF GRANT
-- Target DB : vineford_intake_test
--
-- Closes the Phase 5 → Phase 6 handoff:
--   * Phase 6 is NOT exposed merely because a URL is known. The
--     next-authorized-client-action is unlocked only through a signed
--     handoff grant that the separate downstream portal must present
--     to THIS backend for verification.
--   * vf_issue_phase6_handoff  — create an ACTIVE grant. Gated on the
--     case being actually approved (phase 5 reached, every active
--     verification requirement VERIFIED, and an active client action
--     exists). Only the case's client (same email) or an administrator
--     may issue it. Records approved_at (when PHASE 5 was approved)
--     and unlocked_at (when PHASE 6 was activated) in the grant.
--   * vf_store_phase6_handoff_token — the application stores the
--     signed JWT against the grant (single source of truth, audited).
--   * vf_verify_phase6_handoff — the downstream portal exchanges the
--     token. Re-checks signature claims against live DB state: case
--     still approved, no unverified active requirements, action still
--     active and unexpired, grant not revoked/expired. Audits every
--     verification. Response is explicitly SANDBOX / DEMO — simulated
--     functionality only, never real funds, transfers or balances.
--   * vf_revoke_phase6_handoff — administrator revocation (audited).
--   * vf_get_phase6_handoff_status — read model for the client/admin
--     workflow view (never returns the raw token to clients).
--
-- The token itself is a signed JWT (HMAC) issued by the NestJS
-- application using the existing JWT_SECRET; no secrets or credentials
-- are placed in URLs — the token travels in the request body/header.
--
-- NON-DESTRUCTIVE: additive table/columns/functions only. Existing
-- VF-2026-8282 case data, documents, evidence, messages, invoices,
-- payments, timeline history and audit records are preserved.
-- Run as: postgres superuser.
-- ============================================================

BEGIN;

-- ── 1. case_handoff_grants ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.case_handoff_grants (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_action_id uuid REFERENCES public.case_client_actions(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  purpose text NOT NULL DEFAULT 'phase6_handoff',
  token text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','revoked','expired')),
  issued_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  unlocked_at timestamptz,
  verified_count integer NOT NULL DEFAULT 0,
  last_verified_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_handoff_grants_case_id       ON public.case_handoff_grants(case_id);
CREATE INDEX IF NOT EXISTS idx_handoff_grants_status        ON public.case_handoff_grants(status);
CREATE INDEX IF NOT EXISTS idx_handoff_grants_action        ON public.case_handoff_grants(client_action_id);

ALTER TABLE public.case_handoff_grants OWNER TO vineford_app;

DROP TRIGGER IF EXISTS trigger_update_case_handoff_grants_updated_at ON public.case_handoff_grants;
CREATE TRIGGER trigger_update_case_handoff_grants_updated_at
BEFORE UPDATE ON public.case_handoff_grants
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 2. Issue — Phase 6 handoff grant ─────────────────────────
-- Only an actually approved case unlocks Phase 6. The case client
-- (email match) or an administrator can create the grant.
CREATE OR REPLACE FUNCTION public.vf_issue_phase6_handoff(
  p_case uuid, p_actor uuid, p_action uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_case_number text; v_role public.user_role; v_actor_org uuid;
  v_phase public.workflow_phase; v_pending integer;
  v_approved_at timestamptz; v_expires_at timestamptz;
  v_action public.case_client_actions%ROWTYPE;
  v_grant uuid;
BEGIN
  SELECT organization_id, case_number INTO v_org, v_case_number
  FROM public.cases WHERE id = p_case;
  IF v_org IS NULL THEN RAISE EXCEPTION 'case % not found', p_case; END IF;

  -- Actor authorization.
  SELECT role, organization_id INTO v_role, v_actor_org FROM public.app_users WHERE id = p_actor;
  IF v_role IS NULL THEN RAISE EXCEPTION 'actor % not found', p_actor; END IF;
  IF v_role IN ('super_admin','admin') THEN
    IF v_actor_org IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'permission denied: administrator organization does not match case %', p_case;
    END IF;
  ELSE
    IF v_actor_org IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'permission denied: actor % is not authorized for case %', p_actor, p_case;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.cases c ON c.id = p_case
      JOIN public.clients cl ON cl.id = c.client_id
      WHERE u.id = p_actor AND lower(u.email) = lower(cl.email)
    ) THEN
      RAISE EXCEPTION 'permission denied: only the case client or an administrator may unlock phase 6 (actor %)', p_actor;
    END IF;
  END IF;

  -- Approval gate: the case must be at PHASE 5 or later with every
  -- active verification requirement actually VERIFIED by review.
  SELECT workflow_phase INTO v_phase FROM public.cases WHERE id = p_case;
  IF v_phase NOT IN ('documents_verified','next_client_action') THEN
    RAISE EXCEPTION 'phase 6 handoff cannot be issued: case is not approved (current phase: %)', v_phase;
  END IF;

  SELECT count(*) INTO v_pending
  FROM public.transfer_document_requirements
  WHERE case_id = p_case AND is_active AND status <> 'verified';
  IF v_pending > 0 THEN
    RAISE EXCEPTION 'phase 6 handoff cannot be issued: % active verification requirement(s) are not VERIFIED', v_pending;
  END IF;

  -- The unlocked client action must exist and be active.
  IF p_action IS NULL THEN
    SELECT * INTO v_action FROM public.case_client_actions
    WHERE case_id = p_case AND status = 'active' AND is_client_visible
    ORDER BY activated_at DESC LIMIT 1;
  ELSE
    SELECT * INTO v_action FROM public.case_client_actions WHERE id = p_action;
    IF v_action.id IS NULL OR v_action.case_id <> p_case THEN
      RAISE EXCEPTION 'client action % not found for case %', p_action, p_case;
    END IF;
  END IF;
  IF v_action.id IS NULL THEN
    RAISE EXCEPTION 'phase 6 handoff cannot be issued: no active client action is unlocked for case %', p_case;
  END IF;
  IF v_action.expires_at IS NOT NULL AND v_action.expires_at <= now() THEN
    RAISE EXCEPTION 'phase 6 handoff cannot be issued: client action % has expired', v_action.id;
  END IF;

  -- When Phase 5 was approved (latest approved review) and when
  -- Phase 6 was unlocked (activation of the client action).
  SELECT max(event_date) INTO v_approved_at
  FROM public.timeline
  WHERE case_id = p_case AND phase = 'PHASE 5' AND status = 'VERIFIED';

  v_expires_at := COALESCE(v_action.expires_at, now() + interval '7 days');

  INSERT INTO public.case_handoff_grants (
    case_id, organization_id, client_action_id, actor_id, purpose, token, status,
    issued_at, expires_at, approved_at, unlocked_at, metadata
  ) VALUES (
    p_case, v_org, v_action.id, p_actor, 'phase6_handoff', NULL, 'active',
    now(), v_expires_at, v_approved_at, v_action.activated_at,
    jsonb_build_object(
      'case_number', v_case_number,
      'action_title', v_action.title,
      'action_label', v_action.action_label,
      'purpose', 'phase6_handoff',
      'phase', 'next_client_action',
      'phase_number', 6,
      'sandbox', true,
      'simulated', true
    )
  ) RETURNING id INTO v_grant;

  PERFORM public.vf_append_event(
    p_case, v_org,
    'Phase 6 Handoff Authorization Issued',
    'An authorization handoff for the next authorized client action was issued for case ' || v_case_number ||
    '. This is a SANDBOX / DEMO authorization — no real funds, transfers or balances are involved.',
    'PHASE 6', 'HANDOFF_ISSUED', p_actor, true,
    NULL, NULL, NULL, NULL, NULL, NULL,
    jsonb_build_object('grant_id', v_grant, 'action_id', v_action.id, 'expires_at', v_expires_at, 'sandbox', true),
    now()
  );
  PERFORM public.vf_log_audit(
    v_org, p_actor, 'phase6_handoff_issued', 'case_handoff_grant', v_grant,
    jsonb_build_object('case_id', p_case, 'action_id', v_action.id, 'purpose', 'phase6_handoff',
                       'approved_at', v_approved_at, 'unlocked_at', v_action.activated_at,
                       'expires_at', v_expires_at, 'sandbox', true)
  );

  RETURN jsonb_build_object(
    'grant_id', v_grant, 'case_id', p_case, 'case_number', v_case_number,
    'organization_id', v_org, 'action_id', v_action.id,
    'action_title', v_action.title, 'action_label', v_action.action_label,
    'purpose', 'phase6_handoff', 'status', 'active',
    'approved_at', v_approved_at, 'unlocked_at', v_action.activated_at,
    'issued_at', now(), 'expires_at', v_expires_at,
    'sandbox', true, 'simulated', true,
    'disclaimer', 'SANDBOX / DEMO workflow. This is simulated functionality only — no real funds, transfers, withdrawals, settlements or balances are represented.'
  );
END $$;

-- ── 3. Store the signed token on the grant ───────────────────
CREATE OR REPLACE FUNCTION public.vf_store_phase6_handoff_token(
  p_grant uuid, p_token text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.case_handoff_grants%ROWTYPE;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'handoff token cannot be empty';
  END IF;
  SELECT * INTO v_row FROM public.case_handoff_grants WHERE id = p_grant;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'handoff grant % not found', p_grant; END IF;
  IF v_row.status <> 'active' THEN
    RAISE EXCEPTION 'handoff grant % is not active (status: %)', p_grant, v_row.status;
  END IF;

  UPDATE public.case_handoff_grants
  SET token = p_token, updated_at = now()
  WHERE id = p_grant;

  PERFORM public.vf_log_audit(
    v_row.organization_id, v_row.actor_id, 'phase6_handoff_token_stored', 'case_handoff_grant', p_grant,
    jsonb_build_object('token_present', true)
  );

  RETURN jsonb_build_object('grant_id', p_grant, 'status', 'active', 'token_present', true);
END $$;

-- ── 4. Verify — downstream portal authorization check ────────
-- Re-validates the claims against live DB state so Phase 6 is never
-- reachable just because a URL (or even a stale token) is known.
CREATE OR REPLACE FUNCTION public.vf_verify_phase6_handoff(
  p_grant uuid, p_token text, p_actor uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_g public.case_handoff_grants%ROWTYPE;
  v_phase public.workflow_phase; v_pending integer;
  v_action public.case_client_actions%ROWTYPE;
  v_org uuid; v_case_number text;
  v_mode text; v_amount numeric; v_currency text;
BEGIN
  SELECT * INTO v_g FROM public.case_handoff_grants WHERE id = p_grant;
  IF v_g.id IS NULL THEN RAISE EXCEPTION 'phase 6 handoff grant % not found', p_grant; END IF;

  IF v_g.status = 'revoked' THEN
    RAISE EXCEPTION 'phase 6 handoff grant % has been revoked', p_grant;
  END IF;
  IF v_g.status = 'expired' OR (v_g.expires_at IS NOT NULL AND v_g.expires_at <= now()) THEN
    UPDATE public.case_handoff_grants SET status = 'expired', updated_at = now() WHERE id = p_grant;
    RAISE EXCEPTION 'phase 6 handoff grant % has expired', p_grant;
  END IF;
  IF v_g.token IS NULL OR v_g.token IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'phase 6 handoff token does not match grant %', p_grant;
  END IF;

  -- Optional actor binding: when an actor is supplied they must be the
  -- grant's actor, an administrator, or the case's client (email match).
  IF p_actor IS NOT NULL THEN
    IF v_g.actor_id IS NOT NULL AND v_g.actor_id = p_actor THEN
      NULL; -- grant actor: allowed
    ELSIF EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = p_actor AND role IN ('super_admin','admin')
        AND organization_id = v_g.organization_id
    ) THEN
      NULL; -- administrator: allowed
    ELSIF EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.cases c ON c.id = v_g.case_id
      JOIN public.clients cl ON cl.id = c.client_id
      WHERE u.id = p_actor AND lower(u.email) = lower(cl.email)
    ) THEN
      NULL; -- case client: allowed
    ELSE
      RAISE EXCEPTION 'permission denied: actor % is not authorized for grant %', p_actor, p_grant;
    END IF;
  END IF;

  -- Live approval re-check.
  SELECT workflow_phase INTO v_phase FROM public.cases WHERE id = v_g.case_id;
  IF v_phase NOT IN ('documents_verified','next_client_action') THEN
    RAISE EXCEPTION 'phase 6 is locked: case is not currently approved (phase: %)', v_phase;
  END IF;
  SELECT count(*) INTO v_pending
  FROM public.transfer_document_requirements
  WHERE case_id = v_g.case_id AND is_active AND status <> 'verified';
  IF v_pending > 0 THEN
    RAISE EXCEPTION 'phase 6 is locked: % active verification requirement(s) are not VERIFIED', v_pending;
  END IF;

  IF v_g.client_action_id IS NOT NULL THEN
    SELECT * INTO v_action FROM public.case_client_actions WHERE id = v_g.client_action_id;
    IF v_action.id IS NOT NULL THEN
      IF v_action.status <> 'active' THEN
        RAISE EXCEPTION 'phase 6 is locked: client action % is not active', v_action.id;
      END IF;
      IF v_action.expires_at IS NOT NULL AND v_action.expires_at <= now() THEN
        RAISE EXCEPTION 'phase 6 is locked: client action % has expired', v_action.id;
      END IF;
    END IF;
  END IF;

  UPDATE public.case_handoff_grants
  SET verified_count = verified_count + 1, last_verified_at = now(), updated_at = now()
  WHERE id = p_grant;

  SELECT organization_id, case_number INTO v_org, v_case_number FROM public.cases WHERE id = v_g.case_id;
  SELECT t.mode, t.amount, t.currency INTO v_mode, v_amount, v_currency
  FROM public.case_transfers t
  JOIN public.cases c ON c.current_transfer_id = t.id
  WHERE c.id = v_g.case_id;

  PERFORM public.vf_append_event(
    v_g.case_id, v_org,
    'Phase 6 Handoff Verified',
    'The next authorized client action handoff for case ' || v_case_number ||
    ' was verified. This is a SANDBOX / DEMO authorization — no real funds, transfers, withdrawals, settlements or balances are represented.',
    'PHASE 6', 'HANDOFF_VERIFIED', COALESCE(p_actor, v_g.actor_id), true,
    NULL, NULL, NULL, NULL, NULL, NULL,
    jsonb_build_object('grant_id', v_g.id, 'verified_count', (SELECT verified_count FROM public.case_handoff_grants WHERE id = p_grant), 'sandbox', true),
    now()
  );
  PERFORM public.vf_log_audit(
    v_org, COALESCE(p_actor, v_g.actor_id), 'phase6_handoff_verified', 'case_handoff_grant', p_grant,
    jsonb_build_object('case_id', v_g.case_id, 'action_id', v_g.client_action_id,
                       'verified_count', (SELECT verified_count FROM public.case_handoff_grants WHERE id = p_grant),
                       'sandbox', true)
  );

  RETURN jsonb_build_object(
    'grant_id', v_g.id, 'status', 'active',
    'case_id', v_g.case_id, 'case_number', v_case_number,
    'organization_id', v_org,
    'action_id', v_g.client_action_id,
    'action_title', (SELECT title FROM public.case_client_actions WHERE id = v_g.client_action_id),
    'action_label', (SELECT action_label FROM public.case_client_actions WHERE id = v_g.client_action_id),
    'purpose', v_g.purpose,
    'approved_at', v_g.approved_at, 'unlocked_at', v_g.unlocked_at,
    'issued_at', v_g.issued_at, 'expires_at', v_g.expires_at,
    'verified_count', (SELECT verified_count FROM public.case_handoff_grants WHERE id = p_grant),
    'sandbox', true, 'simulated', true, 'mode', COALESCE(v_mode, 'demo'),
    'amount', v_amount, 'currency', COALESCE(v_currency, 'USD'),
    'disclaimer', 'SANDBOX / DEMO workflow. This is simulated functionality only — no real funds, transfers, withdrawals, settlements or balances are represented. Any amounts shown are simulated and must not be treated as real funds.'
  );
END $$;

-- ── 5. Revoke — administrator ────────────────────────────────
CREATE OR REPLACE FUNCTION public.vf_revoke_phase6_handoff(
  p_grant uuid, p_actor uuid, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_g public.case_handoff_grants%ROWTYPE;
BEGIN
  PERFORM public.vf_require_admin(p_actor);
  SELECT * INTO v_g FROM public.case_handoff_grants WHERE id = p_grant;
  IF v_g.id IS NULL THEN RAISE EXCEPTION 'handoff grant % not found', p_grant; END IF;
  IF v_g.status = 'revoked' THEN
    RAISE EXCEPTION 'handoff grant % is already revoked', p_grant;
  END IF;

  UPDATE public.case_handoff_grants
  SET status = 'revoked', revoked_at = now(), revoked_by = p_actor, updated_at = now()
  WHERE id = p_grant;

  PERFORM public.vf_append_event(
    v_g.case_id, v_g.organization_id,
    'Phase 6 Handoff Revoked',
    'The next authorized client action handoff for case ' || (SELECT case_number FROM public.cases WHERE id = v_g.case_id) ||
    ' was revoked.' || COALESCE(' ' || p_note, ''),
    'PHASE 6', 'HANDOFF_REVOKED', p_actor, true,
    NULL, NULL, NULL, NULL, NULL, NULL,
    jsonb_build_object('grant_id', p_grant),
    now()
  );
  PERFORM public.vf_log_audit(
    v_g.organization_id, p_actor, 'phase6_handoff_revoked', 'case_handoff_grant', p_grant,
    jsonb_build_object('note', p_note)
  );

  RETURN jsonb_build_object('grant_id', p_grant, 'status', 'revoked', 'revoked_at', now());
END $$;

-- ── 6. Status read model ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vf_get_phase6_handoff_status(p_case uuid, p_view text DEFAULT 'admin')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client boolean := (lower(p_view) = 'client');
  v_action public.case_client_actions%ROWTYPE;
  v_g public.case_handoff_grants%ROWTYPE;
  v_approved_at timestamptz; v_unlocked_at timestamptz;
  v_phase public.workflow_phase;
BEGIN
  SELECT workflow_phase INTO v_phase FROM public.cases WHERE id = p_case;

  SELECT * INTO v_action FROM public.case_client_actions
  WHERE case_id = p_case AND status = 'active' AND is_client_visible
  ORDER BY activated_at DESC LIMIT 1;

  IF v_action.id IS NOT NULL THEN
    v_unlocked_at := v_action.activated_at;
  END IF;

  SELECT max(event_date) INTO v_approved_at
  FROM public.timeline
  WHERE case_id = p_case AND phase = 'PHASE 5' AND status = 'VERIFIED';

  SELECT * INTO v_g FROM public.case_handoff_grants
  WHERE case_id = p_case AND purpose = 'phase6_handoff'
  ORDER BY issued_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'case_id', p_case,
    'workflow_phase', v_phase,
    'approved', v_phase IN ('documents_verified','next_client_action'),
    'unlocked', v_action.id IS NOT NULL,
    'approved_at', v_approved_at,
    'unlocked_at', v_unlocked_at,
    'active_action', CASE WHEN v_action.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_action.id, 'title', v_action.title, 'action_label', v_action.action_label,
      'activated_at', v_action.activated_at, 'expires_at', v_action.expires_at
    ) END,
    'active_grant', CASE WHEN v_g.id IS NULL OR v_g.status <> 'active' THEN NULL ELSE jsonb_build_object(
      'grant_id', v_g.id, 'purpose', v_g.purpose, 'status', v_g.status,
      'issued_at', v_g.issued_at, 'expires_at', v_g.expires_at,
      'approved_at', v_g.approved_at, 'unlocked_at', v_g.unlocked_at,
      'verified_count', v_g.verified_count, 'last_verified_at', v_g.last_verified_at,
      'token_present', v_g.token IS NOT NULL
    ) END,
    'sandbox', true, 'simulated', true,
    'disclaimer', 'SANDBOX / DEMO workflow. This is simulated functionality only — no real funds, transfers, withdrawals, settlements or balances are represented.'
  );
END $$;

-- ── 7. Expose handoff status in the case workflow read model ─
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
        )
      )
    ), '[]'::jsonb) END
  ) INTO v_result
  FROM public.cases c WHERE c.id = p_case;

  IF v_result IS NULL THEN RAISE EXCEPTION 'case % not found', p_case; END IF;
  RETURN v_result;
END $$;

-- ── 8. Grants ────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.vf_issue_phase6_handoff(uuid, uuid, uuid) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_store_phase6_handoff_token(uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_verify_phase6_handoff(uuid, text, uuid) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_revoke_phase6_handoff(uuid, uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_phase6_handoff_status(uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_case_workflow(uuid, text) TO vineford_app;

COMMIT;
