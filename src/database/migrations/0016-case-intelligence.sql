-- 0016-case-intelligence.sql
-- Additive: audit visibility, legal hold, phase SLA deadlines, notifications,
-- structured document requests, and document-request linkage. All changes are
-- additive and do not alter existing workflow functions or Phase 1-6 semantics.

-- Legal hold + phase SLA deadlines on cases
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legal_hold_note text,
  ADD COLUMN IF NOT EXISTS phase_sla_hours integer,
  ADD COLUMN IF NOT EXISTS phase_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS phase_deadline_notified_at timestamptz;

-- Client + admin notifications, scoped to a case
CREATE TABLE IF NOT EXISTS public.case_notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_role text NOT NULL DEFAULT 'client' CHECK (recipient_role IN ('client', 'admin')),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_case_notifications_case_id ON public.case_notifications (case_id);
CREATE INDEX IF NOT EXISTS idx_case_notifications_org_id ON public.case_notifications (organization_id);
CREATE INDEX IF NOT EXISTS idx_case_notifications_recipient
  ON public.case_notifications (recipient_role, is_read, created_at DESC);

-- Case scoping on audit logs (per-document access events)
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_audit_logs_case_id ON public.audit_logs (case_id);

-- Structured document requests: track the submitted document and review state
ALTER TABLE public.document_requests
  ADD COLUMN IF NOT EXISTS submitted_document_id uuid,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_note text;

-- Link submitted documents back to the request that produced them
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS document_request_id uuid REFERENCES public.document_requests(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_documents_document_request_id
  ON public.documents (document_request_id);

-- Permissions for the application role (vineford_app). Tables owned by
-- vineford_app bypass RLS; the postgres-owned tables need policies + grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_notifications TO vineford_app;
GRANT SELECT, INSERT, UPDATE ON public.documents TO vineford_app;
GRANT SELECT ON public.audit_logs TO vineford_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_requests TO vineford_app;

-- RLS policies for postgres-owned tables so the application role can manage
-- documents and read audit logs (access is already enforced by the backend
-- actor checks on top of this).
DROP POLICY IF EXISTS "System can read documents" ON public.documents;
CREATE POLICY "System can read documents" ON public.documents
  FOR SELECT TO PUBLIC USING (true);
DROP POLICY IF EXISTS "System can write documents" ON public.documents;
CREATE POLICY "System can write documents" ON public.documents
  FOR INSERT TO PUBLIC WITH CHECK (true);
DROP POLICY IF EXISTS "System can update documents" ON public.documents;
CREATE POLICY "System can update documents" ON public.documents
  FOR UPDATE TO PUBLIC USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "System can read audit logs" ON public.audit_logs;
CREATE POLICY "System can read audit logs" ON public.audit_logs
  FOR SELECT TO PUBLIC USING (true);

-- Reporting aggregates. SECURITY DEFINER so the application role can read
-- postgres-owned tables without exposing them to RLS; the backend gates access.
CREATE OR REPLACE FUNCTION public.vf_dashboard_summary(p_org uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'total_cases', (SELECT count(*) FROM public.cases WHERE organization_id = p_org),
    'open_cases', (SELECT count(*) FROM public.cases WHERE organization_id = p_org AND status = 'open'),
    'on_hold_cases', (SELECT count(*) FROM public.cases WHERE organization_id = p_org AND status = 'on_hold'),
    'closed_cases', (SELECT count(*) FROM public.cases WHERE organization_id = p_org AND status = 'closed'),
    'archived_cases', (SELECT count(*) FROM public.cases WHERE organization_id = p_org AND status = 'archived'),
    'total_clients', (SELECT count(*) FROM public.clients WHERE organization_id = p_org),
    'total_documents', (SELECT count(*) FROM public.documents WHERE organization_id = p_org),
    'total_evidence', (SELECT count(*) FROM public.evidence WHERE organization_id = p_org),
    'total_invoices', (SELECT count(*) FROM public.invoices WHERE organization_id = p_org),
    'paid_invoices', (SELECT count(*) FROM public.invoices WHERE organization_id = p_org AND status = 'paid'),
    'outstanding_invoices', (SELECT count(*) FROM public.invoices WHERE organization_id = p_org AND status IN ('sent','overdue')),
    'outstanding_amount', (SELECT COALESCE(sum(amount),0) FROM public.invoices WHERE organization_id = p_org AND status IN ('sent','overdue')),
    'paid_amount', (SELECT COALESCE(sum(amount),0) FROM public.invoices WHERE organization_id = p_org AND status = 'paid'),
    'open_document_requests', (SELECT count(*) FROM public.document_requests WHERE organization_id = p_org AND status IN ('open','submitted')),
    'overdue_phases', (SELECT count(*) FROM public.cases WHERE organization_id = p_org AND workflow_phase <> 'completed' AND phase_deadline IS NOT NULL AND phase_deadline < now()),
    'legal_holds', (SELECT count(*) FROM public.cases WHERE organization_id = p_org AND legal_hold = true),
    'active_handoffs', (SELECT count(*) FROM public.case_handoff_grants WHERE organization_id = p_org AND status = 'active')
  );
$$;

CREATE OR REPLACE FUNCTION public.vf_dashboard_phase_distribution(p_org uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('phase', workflow_phase, 'count', n) ORDER BY workflow_phase), '[]'::jsonb)
    FROM (SELECT workflow_phase, count(*) AS n FROM public.cases
           WHERE organization_id = p_org GROUP BY workflow_phase) t;
$$;

CREATE OR REPLACE FUNCTION public.vf_dashboard_time_in_phase(p_org uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'phase', t.phase,
            'avg_days', t.avg_days,
            'cases', t.cases) ORDER BY t.phase), '[]'::jsonb)
    FROM (
      SELECT workflow_phase AS phase,
             round(avg(extract(epoch FROM (now() - COALESCE(workflow_updated_at, created_at))) / 86400)::numeric, 1) AS avg_days,
             count(*) AS cases
        FROM public.cases
       WHERE organization_id = p_org AND workflow_phase <> 'completed'
       GROUP BY workflow_phase
    ) t;
$$;

CREATE OR REPLACE FUNCTION public.vf_dashboard_payment_aging(p_org uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket', bucket, 'count', cnt, 'amount', amt) ORDER BY bucket), '[]'::jsonb)
    FROM (
      SELECT CASE
               WHEN due_date >= CURRENT_DATE THEN 'current'
               WHEN (CURRENT_DATE - due_date) <= 30 THEN 'overdue_1_30'
               WHEN (CURRENT_DATE - due_date) <= 60 THEN 'overdue_31_60'
               WHEN (CURRENT_DATE - due_date) <= 90 THEN 'overdue_61_90'
               ELSE 'overdue_90_plus'
             END AS bucket,
             count(*) AS cnt,
             COALESCE(sum(amount), 0) AS amt
        FROM public.invoices
       WHERE organization_id = p_org AND status IN ('sent','overdue')
       GROUP BY 1
    ) t;
$$;
