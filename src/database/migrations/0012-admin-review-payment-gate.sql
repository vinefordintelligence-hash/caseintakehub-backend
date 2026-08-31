-- ============================================================
-- 0012 — ADMIN DOCUMENT REVIEW + GLOBAL PAYMENT GATE
-- Target DB : vineford_intake_test
--
-- PART 1 — Client-document → admin-review workflow:
--   * Document uploads are NEVER preloaded: the system only
--     creates a DOCUMENT REQUIREMENT in REQUIRED state; the
--     client is the one who uploads the actual document.
--   * Verification is driven by an ADMIN REVIEW decision with
--     outcomes APPROVED / REJECTED / NEEDS_INFORMATION.
--   * PHASE 5 (documents_verified) is only reachable through an
--     APPROVED review. PHASE 6 (next client action) stays locked
--     until approval (existing gate in vf_create_next_client_action).
--   * vf_set_requirement_status is restricted to SUBMITTED /
--     UNDER_REVIEW; verified/rejected/needs_information now
--     require vf_admin_review_requirement (admin role enforced).
--
-- PART 2 — Global Payment Gate / Billing Settings:
--   * payment_gate_settings = single GLOBAL (platform) config row,
--     NOT per-case. It only configures HOW the platform presents a
--     legitimate payment requirement.
--   * case_payments = per-CASE payment record. It decides whether a
--     specific client actually has a legitimate charge. Enabling the
--     global gate NEVER auto-creates an obligation.
--   * 'paid' (and 'received') can only be set when an ACTUAL recorded
--     payment exists in the existing payments table for a real invoice
--     on the case — no fabricated confirmations.
--   * Only administrators (super_admin/admin) can modify the global
--     gate. Every change writes an audit_logs row (admin, timestamp,
--     previous value, new value, affected setting).
--
-- NON-DESTRUCTIVE: additive tables/columns/functions + a guarded
-- data correction that re-issues the VF-2026-8282 bank-account
-- verification requirement (REQUIRED, no preloaded document) and
-- re-locks PHASE 6. No imported case data is deleted or overwritten.
-- Run as: postgres superuser, plain `psql file.sql` (NOT -1).
-- ============================================================

BEGIN;

-- ── 1. RBAC helper ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vf_require_admin(p_actor uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role public.user_role;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'administrator authentication required (no actor)';
  END IF;
  SELECT role INTO v_role FROM public.app_users WHERE id = p_actor;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'administrator authentication required (actor %)', p_actor;
  END IF;
  IF v_role NOT IN ('super_admin','admin') THEN
    RAISE EXCEPTION 'permission denied: only administrators can perform this action (actor role: %)', v_role;
  END IF;
END $$;

-- ── 2. Client-facing status labels (single source of truth) ──
-- Used by vf_get_case_workflow so a client is NEVER told a document
-- is verified until an administrator actually approves it.
CREATE OR REPLACE FUNCTION public.vf_requirement_status_label(p_status public.document_requirement_status)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_status
    WHEN 'required' THEN jsonb_build_object(
      'label', 'VERIFICATION DOCUMENTS REQUIRED',
      'message', 'Please upload the requested bank-account verification document.')
    WHEN 'submitted' THEN jsonb_build_object(
      'label', 'DOCUMENT SUBMITTED',
      'message', 'Your verification document has been submitted.')
    WHEN 'under_review' THEN jsonb_build_object(
      'label', 'UNDER REVIEW',
      'message', 'Your verification document is currently being reviewed.')
    WHEN 'needs_information' THEN jsonb_build_object(
      'label', 'ADDITIONAL INFORMATION REQUIRED',
      'message', 'Additional information is required. Please review the reviewer notes and upload a corrected document.')
    WHEN 'rejected' THEN jsonb_build_object(
      'label', 'DOCUMENT REJECTED',
      'message', 'Your document was rejected. Please upload a corrected document.')
    WHEN 'verified' THEN jsonb_build_object(
      'label', 'APPROVED',
      'message', 'Your verification document has been approved.')
    ELSE jsonb_build_object('label', NULL, 'message', NULL)
  END
$$;

-- ── 3. GLOBAL Payment Gate / Billing Settings ────────────────
CREATE TABLE IF NOT EXISTS public.payment_gate_settings (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  enabled boolean NOT NULL DEFAULT false,
  client_visible boolean NOT NULL DEFAULT false,
  payment_title text,
  payment_description text,
  amount numeric(18,2),
  currency text NOT NULL DEFAULT 'USD',
  payment_methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  due_date_behavior jsonb NOT NULL DEFAULT '{}'::jsonb,
  invoice_reference_behavior jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- single global row; a fixed id is enforced
  CONSTRAINT payment_gate_single_row CHECK (id = '00000000-0000-4000-8000-0000000000a7'::uuid),
  -- a live gate requires a configured amount and title (no fabricated charges)
  CONSTRAINT payment_gate_enabled_valid CHECK (NOT enabled OR (amount IS NOT NULL AND amount > 0 AND payment_title IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_payment_gate_enabled ON public.payment_gate_settings(enabled);

ALTER TABLE public.payment_gate_settings OWNER TO vineford_app;

DROP TRIGGER IF EXISTS trigger_update_payment_gate_settings_updated_at ON public.payment_gate_settings;
CREATE TRIGGER trigger_update_payment_gate_settings_updated_at
BEFORE UPDATE ON public.payment_gate_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 4. Per-CASE payment record (legitimate charge only) ──────
CREATE TABLE IF NOT EXISTS public.case_payments (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'not_required'
    CHECK (status IN ('not_required','required','pending','received','failed','cancelled','waived','paid')),
  amount numeric(18,2),
  currency text NOT NULL DEFAULT 'USD',
  payment_method text,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  reference_number text,
  due_date date,
  client_visible boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_case_payments_case UNIQUE (case_id)
);

CREATE INDEX IF NOT EXISTS idx_case_payments_case_id   ON public.case_payments(case_id);
CREATE INDEX IF NOT EXISTS idx_case_payments_status    ON public.case_payments(status);
CREATE INDEX IF NOT EXISTS idx_case_payments_invoice   ON public.case_payments(invoice_id);

ALTER TABLE public.case_payments OWNER TO vineford_app;

DROP TRIGGER IF EXISTS trigger_update_case_payments_updated_at ON public.case_payments;
CREATE TRIGGER trigger_update_case_payments_updated_at
BEFORE UPDATE ON public.case_payments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 5. Payment Gate functions ────────────────────────────────
-- Read the GLOBAL gate config (admin view: full row).
CREATE OR REPLACE FUNCTION public.vf_get_payment_gate()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.payment_gate_settings;
BEGIN
  SELECT * INTO v_row FROM public.payment_gate_settings ORDER BY id LIMIT 1;
  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id', v_row.id, 'enabled', v_row.enabled, 'client_visible', v_row.client_visible,
    'payment_title', v_row.payment_title, 'payment_description', v_row.payment_description,
    'amount', v_row.amount, 'currency', v_row.currency,
    'payment_methods', v_row.payment_methods,
    'due_date_behavior', v_row.due_date_behavior,
    'invoice_reference_behavior', v_row.invoice_reference_behavior,
    'updated_by', v_row.updated_by, 'updated_at', v_row.updated_at);
END $$;

-- Client-visible gate presentation: only when the gate is enabled AND
-- client-visible AND the case actually carries a legitimate charge.
-- This guarantees the global gate NEVER fabricates an obligation.
CREATE OR REPLACE FUNCTION public.vf_get_payment_gate_public(p_case uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_gate public.payment_gate_settings; v_charge_status text; v_due_date date;
BEGIN
  SELECT * INTO v_gate FROM public.payment_gate_settings ORDER BY id LIMIT 1;
  IF v_gate.id IS NULL OR NOT v_gate.enabled OR NOT v_gate.client_visible THEN
    RETURN NULL;
  END IF;

  SELECT status, due_date INTO v_charge_status, v_due_date
  FROM public.case_payments WHERE case_id = p_case;

  IF v_charge_status IS NULL OR v_charge_status = 'not_required' THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'enabled', true,
    'payment_title', v_gate.payment_title,
    'payment_description', v_gate.payment_description,
    'amount', v_gate.amount,
    'currency', v_gate.currency,
    'payment_methods', v_gate.payment_methods,
    'due_date', v_due_date,
    'due_date_behavior', v_gate.due_date_behavior,
    'invoice_reference_behavior', v_gate.invoice_reference_behavior);
END $$;

-- Update the GLOBAL gate (admin-only, fully audited).
CREATE OR REPLACE FUNCTION public.vf_update_payment_gate(
  p_actor uuid,
  p_enabled boolean DEFAULT NULL,
  p_client_visible boolean DEFAULT NULL,
  p_payment_title text DEFAULT NULL,
  p_payment_description text DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_currency text DEFAULT NULL,
  p_payment_methods jsonb DEFAULT NULL,
  p_due_date_behavior jsonb DEFAULT NULL,
  p_invoice_reference_behavior jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := '00000000-0000-4000-8000-0000000000a7'::uuid;
  v_old public.payment_gate_settings%ROWTYPE;
  v_new public.payment_gate_settings%ROWTYPE;
  v_org uuid;
BEGIN
  PERFORM public.vf_require_admin(p_actor);
  SELECT organization_id INTO v_org FROM public.app_users WHERE id = p_actor;

  SELECT * INTO v_old FROM public.payment_gate_settings WHERE id = v_id;
  IF v_old.id IS NULL THEN
    INSERT INTO public.payment_gate_settings (id, created_by, updated_by)
    VALUES (v_id, p_actor, p_actor);
    SELECT * INTO v_old FROM public.payment_gate_settings WHERE id = v_id;
  END IF;

  v_new.enabled               := COALESCE(p_enabled, v_old.enabled);
  v_new.client_visible        := COALESCE(p_client_visible, v_old.client_visible);
  v_new.payment_title         := COALESCE(p_payment_title, v_old.payment_title);
  v_new.payment_description   := COALESCE(p_payment_description, v_old.payment_description);
  v_new.amount                := COALESCE(p_amount, v_old.amount);
  v_new.currency              := COALESCE(p_currency, v_old.currency);
  v_new.payment_methods       := COALESCE(p_payment_methods, v_old.payment_methods);
  v_new.due_date_behavior     := COALESCE(p_due_date_behavior, v_old.due_date_behavior);
  v_new.invoice_reference_behavior := COALESCE(p_invoice_reference_behavior, v_old.invoice_reference_behavior);

  IF v_new.enabled AND (v_new.amount IS NULL OR v_new.amount <= 0 OR v_new.payment_title IS NULL) THEN
    RAISE EXCEPTION 'payment gate cannot be enabled without a payment title and a positive amount';
  END IF;

  UPDATE public.payment_gate_settings
  SET enabled = v_new.enabled, client_visible = v_new.client_visible,
      payment_title = v_new.payment_title, payment_description = v_new.payment_description,
      amount = v_new.amount, currency = v_new.currency,
      payment_methods = v_new.payment_methods,
      due_date_behavior = v_new.due_date_behavior,
      invoice_reference_behavior = v_new.invoice_reference_behavior,
      updated_by = p_actor, updated_at = now()
  WHERE id = v_id;

  -- Audit every changed setting: administrator + timestamp + previous value + new value + affected setting.
  IF v_old.enabled IS DISTINCT FROM v_new.enabled THEN
    PERFORM public.vf_log_audit(v_org, p_actor, 'payment_settings_changed', 'payment_gate_settings', v_id,
      jsonb_build_object('setting', 'enabled', 'previous_value', v_old.enabled, 'new_value', v_new.enabled));
  END IF;
  IF v_old.client_visible IS DISTINCT FROM v_new.client_visible THEN
    PERFORM public.vf_log_audit(v_org, p_actor, 'payment_settings_changed', 'payment_gate_settings', v_id,
      jsonb_build_object('setting', 'client_visible', 'previous_value', v_old.client_visible, 'new_value', v_new.client_visible));
  END IF;
  IF v_old.payment_title IS DISTINCT FROM v_new.payment_title THEN
    PERFORM public.vf_log_audit(v_org, p_actor, 'payment_settings_changed', 'payment_gate_settings', v_id,
      jsonb_build_object('setting', 'payment_title', 'previous_value', v_old.payment_title, 'new_value', v_new.payment_title));
  END IF;
  IF v_old.payment_description IS DISTINCT FROM v_new.payment_description THEN
    PERFORM public.vf_log_audit(v_org, p_actor, 'payment_settings_changed', 'payment_gate_settings', v_id,
      jsonb_build_object('setting', 'payment_description', 'previous_value', v_old.payment_description, 'new_value', v_new.payment_description));
  END IF;
  IF v_old.amount IS DISTINCT FROM v_new.amount THEN
    PERFORM public.vf_log_audit(v_org, p_actor, 'payment_settings_changed', 'payment_gate_settings', v_id,
      jsonb_build_object('setting', 'amount', 'previous_value', v_old.amount, 'new_value', v_new.amount));
  END IF;
  IF v_old.currency IS DISTINCT FROM v_new.currency THEN
    PERFORM public.vf_log_audit(v_org, p_actor, 'payment_settings_changed', 'payment_gate_settings', v_id,
      jsonb_build_object('setting', 'currency', 'previous_value', v_old.currency, 'new_value', v_new.currency));
  END IF;
  IF v_old.payment_methods IS DISTINCT FROM v_new.payment_methods THEN
    PERFORM public.vf_log_audit(v_org, p_actor, 'payment_settings_changed', 'payment_gate_settings', v_id,
      jsonb_build_object('setting', 'payment_methods', 'previous_value', v_old.payment_methods, 'new_value', v_new.payment_methods));
  END IF;
  IF v_old.due_date_behavior IS DISTINCT FROM v_new.due_date_behavior THEN
    PERFORM public.vf_log_audit(v_org, p_actor, 'payment_settings_changed', 'payment_gate_settings', v_id,
      jsonb_build_object('setting', 'due_date_behavior', 'previous_value', v_old.due_date_behavior, 'new_value', v_new.due_date_behavior));
  END IF;
  IF v_old.invoice_reference_behavior IS DISTINCT FROM v_new.invoice_reference_behavior THEN
    PERFORM public.vf_log_audit(v_org, p_actor, 'payment_settings_changed', 'payment_gate_settings', v_id,
      jsonb_build_object('setting', 'invoice_reference_behavior', 'previous_value', v_old.invoice_reference_behavior, 'new_value', v_new.invoice_reference_behavior));
  END IF;

  RETURN public.vf_get_payment_gate();
END $$;

-- Audit history for the global gate (admin).
CREATE OR REPLACE FUNCTION public.vf_get_payment_gate_audit()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', a.id, 'actor_id', a.user_id, 'actor_name', public.vf_actor_name(a.user_id),
      'action', a.action, 'setting', (a.changes->>'setting'),
      'previous_value', (a.changes->>'previous_value'),
      'new_value', (a.changes->>'new_value'),
      'created_at', a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM public.audit_logs a
  WHERE a.resource_type = 'payment_gate_settings'
    AND a.action = 'payment_settings_changed';
  RETURN v_result;
END $$;

-- Read the per-case payment record.
CREATE OR REPLACE FUNCTION public.vf_get_case_payment(p_case uuid, p_view text DEFAULT 'admin')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.case_payments%ROWTYPE; v_client boolean := (lower(p_view) = 'client');
BEGIN
  SELECT * INTO v_row FROM public.case_payments WHERE case_id = p_case;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_required', 'exists', false);
  END IF;
  RETURN jsonb_build_object(
    'exists', true, 'id', v_row.id, 'case_id', v_row.case_id,
    'status', v_row.status, 'client_visible', v_row.client_visible,
    'amount', v_row.amount, 'currency', v_row.currency,
    'payment_method', v_row.payment_method, 'due_date', v_row.due_date,
    'invoice_id', v_row.invoice_id,
    'reference_number', CASE WHEN v_client THEN NULL ELSE v_row.reference_number END,
    'notes', CASE WHEN v_client THEN NULL ELSE v_row.notes END,
    'updated_at', v_row.updated_at);
END $$;

-- Set the per-case payment status. Only an ACTUAL recorded payment
-- (existing payments row for a real invoice on the case) may produce
-- RECEIVED or PAID. All transitions are audited.
CREATE OR REPLACE FUNCTION public.vf_set_case_payment_status(
  p_case uuid, p_actor uuid, p_status text,
  p_amount numeric DEFAULT NULL, p_currency text DEFAULT NULL,
  p_payment_method text DEFAULT NULL, p_due_date date DEFAULT NULL,
  p_invoice_id uuid DEFAULT NULL, p_reference_number text DEFAULT NULL,
  p_client_visible boolean DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_client uuid; v_inv_case uuid; v_has_payment boolean;
  v_prev_status text; v_payment_id uuid; v_exists boolean;
BEGIN
  PERFORM public.vf_require_admin(p_actor);

  IF p_status NOT IN ('not_required','required','pending','received','failed','cancelled','waived','paid') THEN
    RAISE EXCEPTION 'invalid case payment status: %', p_status;
  END IF;

  SELECT organization_id INTO v_org FROM public.cases WHERE id = p_case;
  IF v_org IS NULL THEN RAISE EXCEPTION 'case % not found', p_case; END IF;

  SELECT status INTO v_prev_status FROM public.case_payments WHERE case_id = p_case;
  IF v_prev_status IS NULL THEN
    v_prev_status := 'not_required';
    v_exists := false;
  ELSE
    v_exists := true;
  END IF;

  -- Payment integrity: RECEIVED/PAID require an actual recorded payment.
  IF p_status IN ('received','paid') THEN
    IF p_invoice_id IS NULL THEN
      RAISE EXCEPTION 'cannot mark %: an actual recorded payment (invoice_id) is required', p_status;
    END IF;
    SELECT case_id INTO v_inv_case FROM public.invoices WHERE id = p_invoice_id;
    IF v_inv_case IS NULL OR v_inv_case <> p_case THEN
      RAISE EXCEPTION 'cannot mark %: invoice % does not belong to case %', p_status, p_invoice_id, p_case;
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.payments p WHERE p.invoice_id = p_invoice_id
    ) INTO v_has_payment;
    IF NOT v_has_payment THEN
      RAISE EXCEPTION 'cannot mark %: no actual recorded payment exists for invoice %', p_status, p_invoice_id;
    END IF;
  END IF;

  SELECT client_id INTO v_client FROM public.cases WHERE id = p_case;

  IF NOT v_exists THEN
    INSERT INTO public.case_payments (
      case_id, organization_id, client_id, status, amount, currency,
      payment_method, invoice_id, reference_number, due_date,
      client_visible, notes, created_by, updated_by
    ) VALUES (
      p_case, v_org, v_client, p_status, p_amount, COALESCE(p_currency,'USD'),
      p_payment_method, p_invoice_id, p_reference_number, p_due_date,
      COALESCE(p_client_visible, false), p_notes, p_actor, p_actor
    ) RETURNING id INTO v_payment_id;
  ELSE
    UPDATE public.case_payments
    SET status = p_status,
        amount = COALESCE(p_amount, amount),
        currency = COALESCE(p_currency, currency),
        payment_method = COALESCE(p_payment_method, payment_method),
        invoice_id = COALESCE(p_invoice_id, invoice_id),
        reference_number = COALESCE(p_reference_number, reference_number),
        due_date = COALESCE(p_due_date, due_date),
        client_visible = COALESCE(p_client_visible, client_visible),
        notes = COALESCE(p_notes, notes),
        updated_by = p_actor, updated_at = now()
    WHERE case_id = p_case
    RETURNING id INTO v_payment_id;
  END IF;

  PERFORM public.vf_log_audit(
    v_org, p_actor, 'case_payment_' || p_status, 'case_payment', v_payment_id,
    jsonb_build_object('from_status', v_prev_status, 'to_status', p_status,
                       'invoice_id', p_invoice_id, 'reference_number', p_reference_number,
                       'amount', p_amount, 'currency', COALESCE(p_currency,'USD'), 'note', p_notes));

  PERFORM public.vf_append_event(
    p_case, v_org,
    CASE p_status
      WHEN 'paid' THEN 'Payment Received (Paid)'
      WHEN 'received' THEN 'Payment Received'
      WHEN 'required' THEN 'Payment Required'
      WHEN 'pending' THEN 'Payment Pending'
      WHEN 'failed' THEN 'Payment Failed'
      WHEN 'cancelled' THEN 'Payment Cancelled'
      WHEN 'waived' THEN 'Payment Waived'
      ELSE 'Payment Not Required'
    END,
    'Case payment status changed from ' || v_prev_status || ' to ' || p_status ||
    COALESCE('. ' || p_notes, ''),
    'PAYMENT', upper(p_status), p_actor,
    COALESCE(p_client_visible, v_exists AND p_client_visible IS NOT NULL),
    NULL, NULL, p_amount, COALESCE(p_currency,'USD'), NULL, NULL,
    jsonb_build_object('case_payment_id', v_payment_id, 'invoice_id', p_invoice_id),
    now()
  );

  RETURN public.vf_get_case_payment(p_case, 'admin');
END $$;

-- ── 6. Client document upload (corrected) ────────────────────
-- The client (not the system) uploads the actual document. Re-uploads
-- are allowed while the requirement is NOT verified; a re-upload clears
-- the previous review so the document is re-reviewed from scratch.
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
  IF v_status = 'verified' THEN
    RAISE EXCEPTION 'requirement % is already verified (approved) and cannot be re-uploaded', p_requirement;
  END IF;

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
      reviewed_at = NULL,
      reviewed_by = NULL,
      review_note = NULL,
      updated_at = now()
  WHERE id = p_requirement;

  SELECT transfer_reference, amount, currency INTO v_ref, v_amount, v_currency
  FROM public.case_transfers WHERE id = v_transfer;

  PERFORM public.vf_append_event(
    v_case, v_org, 'Verification Document Submitted',
    'Required document "' || v_req_title || '" was uploaded by ' || public.vf_actor_name(p_actor) ||
    '. Status: SUBMITTED — pending admin review.',
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

-- ── 7. Requirement status transitions (restricted) ───────────
-- Now limited to SUBMITTED (client upload hand-off) and UNDER_REVIEW
-- (admin begins review). VERIFIED / REJECTED / NEEDS_INFORMATION are
-- ONLY reachable through vf_admin_review_requirement (admin role +
-- audit). This prevents Phase 5 from being reached without an
-- approved review.
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

  IF p_status NOT IN ('submitted','under_review') THEN
    RAISE EXCEPTION 'status % is not allowed via this path: use vf_admin_review_requirement for approved/rejected/needs_information', p_status;
  END IF;
  IF p_status = 'under_review' THEN
    PERFORM public.vf_require_admin(p_actor);
  END IF;

  SELECT transfer_reference, amount, currency INTO v_ref, v_amount, v_currency
  FROM public.case_transfers WHERE id = v_transfer;

  UPDATE public.transfer_document_requirements
  SET status = p_status::public.document_requirement_status,
      submitted_document_id = COALESCE(p_document, submitted_document_id),
      submitted_at = CASE WHEN p_status = 'submitted' THEN now() ELSE submitted_at END,
      submitted_by = CASE WHEN p_status = 'submitted' THEN p_actor ELSE submitted_by END,
      updated_at = now()
  WHERE id = p_req;

  IF p_status = 'under_review' THEN
    UPDATE public.cases
    SET workflow_phase = 'documents_under_review',
        workflow_phase_number = 4,
        workflow_updated_at = now()
    WHERE id = v_case
      AND workflow_phase NOT IN ('documents_verified','next_client_action','case_review','completed');
    v_phase := 'PHASE 4'; v_status := 'UNDER_REVIEW';
    v_event_title := 'Documents Under Review';
  ELSE
    v_phase := 'CLIENT ACTION'; v_status := 'SUBMITTED';
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
      WHEN 'under_review' THEN 'Your bank-account verification document has been received and is under review by an administrator.'
      ELSE 'Required document "' || v_title || '" was uploaded and is pending admin review.'
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

-- ── 8. ADMIN REVIEW decision ─────────────────────────────────
-- The ONLY path to VERIFIED / REJECTED / NEEDS_INFORMATION.
--   approved         -> requirement VERIFIED, transfer receiving-details
--                       verified, PHASE 5 (documents_verified). Unlocks
--                       PHASE 6 (via the existing gate).
--   rejected         -> requirement REJECTED, receiving details NOT
--                       verified, PHASE 4. PHASE 5 is never reached.
--   needs_information-> requirement NEEDS_INFORMATION, receiving details
--                       NOT verified, case returns to PHASE 3
--                       (verification_documents_requested) so the client
--                       can see what is required and re-submit.
CREATE OR REPLACE FUNCTION public.vf_admin_review_requirement(
  p_req uuid, p_outcome text, p_actor uuid, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_case uuid; v_org uuid; v_title text; v_transfer uuid;
  v_ref text; v_amount numeric; v_currency text; v_status text;
BEGIN
  PERFORM public.vf_require_admin(p_actor);

  IF p_outcome NOT IN ('approved','rejected','needs_information') THEN
    RAISE EXCEPTION 'invalid admin review outcome: % (expected approved/rejected/needs_information)', p_outcome;
  END IF;

  SELECT case_id, organization_id, title, transfer_id, status
    INTO v_case, v_org, v_title, v_transfer, v_status
  FROM public.transfer_document_requirements WHERE id = p_req;
  IF v_case IS NULL THEN RAISE EXCEPTION 'requirement % not found', p_req; END IF;
  IF v_status NOT IN ('submitted','under_review') THEN
    RAISE EXCEPTION 'cannot review requirement in status %: it must first be submitted and under review', v_status;
  END IF;

  SELECT transfer_reference, amount, currency INTO v_ref, v_amount, v_currency
  FROM public.case_transfers WHERE id = v_transfer;

  UPDATE public.transfer_document_requirements
  SET status = (CASE p_outcome
        WHEN 'approved' THEN 'verified'::public.document_requirement_status
        WHEN 'rejected' THEN 'rejected'::public.document_requirement_status
        ELSE 'needs_information'::public.document_requirement_status END),
      reviewed_at = now(),
      reviewed_by = p_actor,
      review_note = COALESCE(p_note, review_note),
      updated_at = now()
  WHERE id = p_req;

  -- Reflect receiving-account verification state on the transfer.
  IF v_transfer IS NOT NULL THEN
    IF p_outcome = 'approved' THEN
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
    ELSIF p_outcome IN ('rejected','needs_information') THEN
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

  -- Case phase transitions.
  IF p_outcome = 'approved' THEN
    UPDATE public.cases
    SET workflow_phase = 'documents_verified',
        workflow_phase_number = 5,
        workflow_updated_at = now()
    WHERE id = v_case AND workflow_phase <> 'next_client_action';
  ELSIF p_outcome = 'needs_information' THEN
    -- Return the case to the required-information workflow (PHASE 3).
    UPDATE public.cases
    SET workflow_phase = 'verification_documents_requested',
        workflow_phase_number = 3,
        workflow_updated_at = now()
    WHERE id = v_case;
  ELSE
    UPDATE public.cases
    SET workflow_phase = 'documents_under_review',
        workflow_phase_number = 4,
        workflow_updated_at = now()
    WHERE id = v_case
      AND workflow_phase NOT IN ('documents_verified','next_client_action','case_review','completed');
  END IF;

  PERFORM public.vf_append_event(
    v_case, v_org,
    CASE p_outcome
      WHEN 'approved' THEN 'Documents Verified'
      WHEN 'rejected' THEN 'Verification Document Rejected'
      ELSE 'Verification Document Needs Information' END,
    CASE p_outcome
      WHEN 'approved' THEN 'Document "' || v_title || '" was APPROVED by ' || public.vf_actor_name(p_actor) ||
                         '. The reviewer confirmed that the receiving-account details on the uploaded document match the configured account information.' || COALESCE(' ' || p_note, '')
      WHEN 'rejected' THEN 'Document "' || v_title || '" was REJECTED by ' || public.vf_actor_name(p_actor) || '. Receiving-account details are NOT verified and PHASE 5 was not reached.' || COALESCE(' ' || p_note, '')
      ELSE 'Document "' || v_title || '" requires additional information from ' || public.vf_actor_name(p_actor) || '.' || COALESCE(' ' || p_note, '') END,
    CASE p_outcome
      WHEN 'approved' THEN 'PHASE 5'
      WHEN 'rejected' THEN 'PHASE 4'
      ELSE 'PHASE 3' END,
    CASE p_outcome
      WHEN 'approved' THEN 'VERIFIED'
      WHEN 'rejected' THEN 'REJECTED'
      ELSE 'NEEDS_INFORMATION' END,
    p_actor, true,
    v_transfer, v_ref, v_amount, v_currency, NULL, p_req,
    jsonb_build_object('outcome', p_outcome, 'note', p_note),
    now()
  );
  PERFORM public.vf_log_audit(
    v_org, p_actor, 'requirement_' || p_outcome, 'transfer_document_requirement', p_req,
    jsonb_build_object('title', v_title, 'outcome', p_outcome, 'transfer_id', v_transfer, 'note', p_note)
  );

  RETURN (SELECT jsonb_build_object('id', id, 'status', status, 'review_note', review_note,
                                   'reviewed_at', reviewed_at, 'reviewed_by', reviewed_by, 'updated_at', updated_at)
          FROM public.transfer_document_requirements WHERE id = p_req);
END $$;

-- ── 9. Admin review detail / review history ──────────────────
CREATE OR REPLACE FUNCTION public.vf_get_requirement_detail(p_req uuid, p_view text DEFAULT 'admin')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb; v_client boolean := (lower(p_view) = 'client');
BEGIN
  SELECT jsonb_build_object(
    'id', r.id, 'case_id', r.case_id, 'transfer_id', r.transfer_id,
    'requirement_key', r.requirement_key, 'title', r.title,
    'description', r.description, 'category', r.category,
    'status', r.status, 'sort_order', r.sort_order, 'is_active', r.is_active,
    'is_client_visible', r.is_client_visible,
    'client_status', public.vf_requirement_status_label(r.status),
    'submitted_at', r.submitted_at, 'submitted_by', r.submitted_by,
    'submitted_by_name', public.vf_actor_name(r.submitted_by),
    'reviewed_at', r.reviewed_at, 'reviewed_by', r.reviewed_by,
    'reviewed_by_name', public.vf_actor_name(r.reviewed_by),
    'review_note', CASE WHEN v_client THEN NULL ELSE r.review_note END,
    'document', (SELECT jsonb_build_object(
        'id', d.id, 'title', d.title, 'file_name', d.file_name, 'file_size', d.file_size,
        'mime_type', d.mime_type, 'file_url', d.file_url, 'document_status', d.document_status,
        'uploaded_at', d.uploaded_at, 'uploaded_by', d.uploaded_by, 'metadata', d.metadata)
        FROM public.documents d WHERE d.id = r.submitted_document_id),
    'review_history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'phase', e.phase, 'status', e.status, 'title', e.title,
        'description', e.description, 'event_date', e.event_date,
        'actor_id', e.actor_id, 'actor_name', e.actor_name) ORDER BY e.event_date, e.created_at)
      FROM public.timeline e WHERE e.requirement_id = r.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.transfer_document_requirements r
  WHERE r.id = p_req;

  IF v_result IS NULL THEN RAISE EXCEPTION 'requirement % not found', p_req; END IF;
  RETURN v_result;
END $$;

-- ── 10. Extended case workflow read model ────────────────────
-- Adds per-requirement client labels, the global payment gate, and the
-- per-case payment record.
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
        )
      )
    ), '[]'::jsonb) END
  ) INTO v_result
  FROM public.cases c WHERE c.id = p_case;

  IF v_result IS NULL THEN RAISE EXCEPTION 'case % not found', p_case; END IF;
  RETURN v_result;
END $$;

-- ── 11. VF-2026-8282 correction ──────────────────────────────
-- Re-issue the bank-account verification requirement: REQUIRED with NO
-- preloaded document. Re-lock PHASE 6 by deactivating the previously
-- created next-client action and resetting the workflow to PHASE 3.
-- This touches ONLY the requirement/transfer/action created during the
-- 0011 validation run; all imported case data is preserved.
DO $$
DECLARE v_case uuid := '7b2abe2a-9312-42b8-a48d-408fd1771b77'::uuid;
        v_org uuid := 'a66e5f92-5c3c-42d5-b270-fba206ef5c0b'::uuid;
        v_transfer uuid; v_req uuid; v_action uuid;
BEGIN
  SELECT id INTO v_transfer FROM public.case_transfers
   WHERE case_id = v_case AND transfer_reference = 'VF20268282-0002';

  SELECT id INTO v_req FROM public.transfer_document_requirements
   WHERE case_id = v_case AND requirement_key = 'bank_account_verification_document';

  IF v_req IS NOT NULL THEN
    UPDATE public.transfer_document_requirements
    SET status = 'required',
        submitted_document_id = NULL,
        submitted_at = NULL,
        submitted_by = NULL,
        reviewed_at = NULL,
        reviewed_by = NULL,
        review_note = NULL,
        updated_at = now()
    WHERE id = v_req;
  END IF;

  IF v_transfer IS NOT NULL THEN
    UPDATE public.case_transfers
    SET status = 'under_review',
        receiving_details_verified = false,
        receiving_details_verified_at = NULL,
        receiving_details_verified_by = NULL,
        receiving_details_verification_note = NULL,
        acceptance_verified = false,
        acceptance_verified_at = NULL,
        acceptance_verified_by = NULL,
        acceptance_verification_note = NULL,
        updated_at = now()
    WHERE id = v_transfer;
  END IF;

  UPDATE public.cases
  SET workflow_phase = 'verification_documents_requested',
      workflow_phase_number = 3,
      workflow_updated_at = now()
  WHERE id = v_case;

  UPDATE public.case_client_actions
  SET status = 'inactive', updated_at = now()
  WHERE case_id = v_case AND status = 'active';

  -- Test-uploaded documents from the 0011 validation run become
  -- admin-only artifacts; the re-issued requirement has NO preloaded
  -- document and the client must upload a fresh one.
  UPDATE public.documents
  SET is_client_visible = false, updated_at = now()
  WHERE case_id = v_case
    AND document_type = 'bank_account_verification'
    AND uploaded_at > now() - interval '2 hours'
    AND is_client_visible = true
    AND id NOT IN (SELECT submitted_document_id FROM public.transfer_document_requirements WHERE case_id = v_case AND submitted_document_id IS NOT NULL);

  PERFORM public.vf_append_event(
    v_case, v_org, 'Verification Documents Requested (re-issued)',
    'The bank-account verification requirement was re-issued in REQUIRED state with no preloaded document. The client must upload the document; an administrator must then review and approve it before the receiving-account details can be verified and before any next client action can be created.',
    'PHASE 3', 'REQUIRED', NULL, true, v_transfer, NULL, NULL, NULL, NULL, v_req, NULL, now());

  PERFORM public.vf_log_audit(
    v_org, 'a0000000-0000-4000-8000-000000000001', 'verification_documents_reissued', 'transfer_document_requirement', v_req,
    jsonb_build_object('status', 'required', 'preloaded_document', false, 'phase', 'verification_documents_requested'));
END $$;

-- ── 12. Grants ───────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.vf_require_admin(uuid) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_requirement_status_label(public.document_requirement_status) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_payment_gate() TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_payment_gate_public(uuid) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_update_payment_gate(uuid, boolean, boolean, text, text, numeric, text, jsonb, jsonb, jsonb) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_payment_gate_audit() TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_case_payment(uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_set_case_payment_status(uuid, uuid, text, numeric, text, text, date, uuid, text, boolean, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_upload_verification_document(uuid, uuid, text, text, text, text, bigint, text, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_set_requirement_status(uuid, text, uuid, text, uuid) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_admin_review_requirement(uuid, text, uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_requirement_detail(uuid, text) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_case_workflow(uuid, text) TO vineford_app;

COMMIT;
