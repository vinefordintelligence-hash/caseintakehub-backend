-- 0024 — Operational and investigation core
-- Additive/idempotent only. Review and apply separately; this file is not auto-run.
BEGIN;

-- Composite keys make organization/case consistency enforceable by foreign keys.
-- All referenced IDs are already globally unique; these indexes add no data changes.
CREATE UNIQUE INDEX IF NOT EXISTS ux_clients_org_id ON public.clients(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_app_users_org_id ON public.app_users(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cases_org_id ON public.cases(organization_id,id);

CREATE TABLE IF NOT EXISTS public.case_intakes (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  client_id uuid,
  submitted_by uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','under_review','accepted','rejected','converted')),
  email text, category text, incident_description text, urgency text,
  draft_token_hash text, converted_case_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz, reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,client_id) REFERENCES public.clients(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,submitted_by) REFERENCES public.app_users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,converted_case_id) REFERENCES public.cases(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_case_intakes_org_status ON public.case_intakes(organization_id,status);

CREATE TABLE IF NOT EXISTS public.case_tasks (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  case_id uuid NOT NULL,
  title text NOT NULL, description text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','waiting_on_client','completed','cancelled')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to uuid,
  client_visible boolean NOT NULL DEFAULT false,
  due_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,case_id) REFERENCES public.cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,assigned_to) REFERENCES public.app_users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,created_by) REFERENCES public.app_users(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (organization_id,case_id,id)
);
CREATE INDEX IF NOT EXISTS idx_case_tasks_org_case ON public.case_tasks(organization_id,case_id);
CREATE INDEX IF NOT EXISTS idx_case_tasks_assignee_status ON public.case_tasks(organization_id,assigned_to,status);

CREATE TABLE IF NOT EXISTS public.case_task_dependencies (
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  task_id uuid NOT NULL,
  depends_on_task_id uuid NOT NULL,
  PRIMARY KEY(task_id,depends_on_task_id), CHECK(task_id<>depends_on_task_id),
  FOREIGN KEY (organization_id,case_id,task_id) REFERENCES public.case_tasks(organization_id,case_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,case_id,depends_on_task_id) REFERENCES public.case_tasks(organization_id,case_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_case_task_dependencies_org_case ON public.case_task_dependencies(organization_id,case_id);

CREATE TABLE IF NOT EXISTS public.case_task_history (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  task_id uuid NOT NULL, organization_id uuid NOT NULL, case_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL, before_value jsonb, after_value jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,case_id,task_id) REFERENCES public.case_tasks(organization_id,case_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,actor_id) REFERENCES public.app_users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.evidence_custody_events (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  case_id uuid NOT NULL, evidence_id uuid NOT NULL, actor_id uuid NOT NULL,
  action text NOT NULL, reason text NOT NULL, from_custodian uuid, to_custodian uuid,
  integrity_hash text CHECK (integrity_hash IS NULL OR integrity_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (evidence_id) REFERENCES public.evidence(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,actor_id) REFERENCES public.app_users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,from_custodian) REFERENCES public.app_users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,to_custodian) REFERENCES public.app_users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_evidence_custody_org_evidence ON public.evidence_custody_events(organization_id,evidence_id,created_at);

CREATE TABLE IF NOT EXISTS public.investigation_entities (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  case_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('person','organization','wallet','account','email','phone','domain','ip','other')),
  display_name text NOT NULL, normalized_value text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,case_id) REFERENCES public.cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,created_by) REFERENCES public.app_users(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,case_id,entity_type,normalized_value),
  UNIQUE(organization_id,case_id,id)
);
CREATE INDEX IF NOT EXISTS idx_investigation_entities_org_case ON public.investigation_entities(organization_id,case_id);

CREATE TABLE IF NOT EXISTS public.entity_relationships (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  case_id uuid NOT NULL, source_entity_id uuid NOT NULL, target_entity_id uuid NOT NULL,
  relationship_type text NOT NULL, confidence smallint CHECK (confidence BETWEEN 0 AND 100),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK(source_entity_id<>target_entity_id),
  FOREIGN KEY (organization_id,case_id) REFERENCES public.cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,case_id,source_entity_id) REFERENCES public.investigation_entities(organization_id,case_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,case_id,target_entity_id) REFERENCES public.investigation_entities(organization_id,case_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,created_by) REFERENCES public.app_users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_entity_relationships_org_case ON public.entity_relationships(organization_id,case_id);

CREATE TABLE IF NOT EXISTS public.investigation_findings (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  case_id uuid NOT NULL,
  title text NOT NULL, narrative text NOT NULL, source text,
  confidence smallint CHECK (confidence BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reviewed','accepted','rejected')),
  created_by uuid NOT NULL, reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,case_id) REFERENCES public.cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,created_by) REFERENCES public.app_users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,reviewed_by) REFERENCES public.app_users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_investigation_findings_org_case ON public.investigation_findings(organization_id,case_id);

-- The API authenticates end users and applies verified organization/case scope.
-- RLS limits these tables to the trusted backend database role; it never derives
-- authorization from user-controlled headers or session settings.
DO $migration$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'case_intakes','case_tasks','case_task_dependencies','case_task_history',
    'evidence_custody_events','investigation_entities','entity_relationships','investigation_findings'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name AND policyname='vineford_backend_select') THEN
      EXECUTE format('CREATE POLICY vineford_backend_select ON public.%I FOR SELECT TO vineford_app USING (true)', table_name);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name AND policyname='vineford_backend_insert') THEN
      EXECUTE format('CREATE POLICY vineford_backend_insert ON public.%I FOR INSERT TO vineford_app WITH CHECK (true)', table_name);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name AND policyname='vineford_backend_update') THEN
      EXECUTE format('CREATE POLICY vineford_backend_update ON public.%I FOR UPDATE TO vineford_app USING (true) WITH CHECK (true)', table_name);
    END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', table_name);
  END LOOP;
END
$migration$;

GRANT SELECT,INSERT,UPDATE ON public.case_intakes,public.case_tasks,public.investigation_findings TO vineford_app;
GRANT SELECT,INSERT ON public.case_task_dependencies,public.case_task_history,public.evidence_custody_events,
  public.investigation_entities,public.entity_relationships TO vineford_app;

COMMIT;
