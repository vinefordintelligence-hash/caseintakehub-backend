BEGIN;

ALTER TABLE public.case_assignments
  ADD COLUMN IF NOT EXISTS assignment_kind text NOT NULL DEFAULT 'supporting',
  ADD COLUMN IF NOT EXISTS internal_note text,
  ADD COLUMN IF NOT EXISTS removal_reason text;

DO $$ BEGIN
  ALTER TABLE public.case_assignments ADD CONSTRAINT case_assignments_kind_check
    CHECK (assignment_kind IN ('primary','supporting'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.case_assignment_history (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES public.case_assignments(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('assigned','reassigned','removed')),
  actor_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  assigned_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  previous_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  assignment_role text NOT NULL,
  assignment_kind text NOT NULL CHECK (assignment_kind IN ('primary','supporting')),
  reason text,
  internal_note text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_case_assignment_history_case
  ON public.case_assignment_history (organization_id, case_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_assignments_workload
  ON public.case_assignments (organization_id, app_user_id, active);

ALTER TABLE public.case_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_assignment_history NO FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS case_assignment_history_service_only ON public.case_assignment_history;
CREATE POLICY case_assignment_history_service_only ON public.case_assignment_history
  FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

COMMIT;
