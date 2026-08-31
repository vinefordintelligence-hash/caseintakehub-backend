BEGIN;

CREATE TYPE public.workflow_lifecycle_status AS ENUM ('DRAFT','PUBLISHED','ARCHIVED');
CREATE TYPE public.workflow_execution_status AS ENUM ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED');
CREATE TYPE public.workflow_job_status AS ENUM ('PENDING','RUNNING','WAITING','COMPLETED','DEAD_LETTER','CANCELLED');

CREATE TABLE public.workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 160), description text NOT NULL DEFAULT '',
  status public.workflow_lifecycle_status NOT NULL DEFAULT 'DRAFT', version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0), trigger_type text,
  created_by uuid NOT NULL REFERENCES public.app_users(id), updated_by uuid NOT NULL REFERENCES public.app_users(id),
  published_at timestamptz, published_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
  UNIQUE(organization_id,id)
);

CREATE TABLE public.workflow_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_id uuid NOT NULL REFERENCES public.workflow_definitions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id), node_type text NOT NULL CHECK(node_type IN ('TRIGGER','CONDITION','ACTION','END')),
  subtype text NOT NULL, label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200), configuration jsonb NOT NULL DEFAULT '{}',
  position_x double precision NOT NULL DEFAULT 0, position_y double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workflow_id,id), CHECK(jsonb_typeof(configuration)='object')
);

CREATE TABLE public.workflow_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_id uuid NOT NULL REFERENCES public.workflow_definitions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id), source_node_id uuid NOT NULL, target_node_id uuid NOT NULL,
  source_handle text, target_handle text, configuration jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workflow_id,source_node_id) REFERENCES public.workflow_nodes(workflow_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workflow_id,target_node_id) REFERENCES public.workflow_nodes(workflow_id,id) ON DELETE CASCADE,
  UNIQUE(workflow_id,source_node_id,target_node_id,source_handle), CHECK(source_node_id<>target_node_id), CHECK(jsonb_typeof(configuration)='object')
);

CREATE TABLE public.workflow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_id uuid NOT NULL REFERENCES public.workflow_definitions(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id), version integer NOT NULL CHECK(version>0), snapshot jsonb NOT NULL,
  published_by uuid NOT NULL REFERENCES public.app_users(id), published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workflow_id,version), CHECK(jsonb_typeof(snapshot)='object')
);

CREATE TABLE public.workflow_domain_events (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id), case_id uuid REFERENCES public.cases(id),
  event_type text NOT NULL, actor_id uuid, actor_type text NOT NULL CHECK(actor_type IN ('admin','investigator','client','system')),
  entity_type text NOT NULL, entity_id text NOT NULL, occurred_at timestamptz NOT NULL, metadata jsonb NOT NULL DEFAULT '{}',
  correlation_id uuid NOT NULL, causation_id uuid, depth integer NOT NULL DEFAULT 0 CHECK(depth BETWEEN 0 AND 16), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id)
);

CREATE TABLE public.workflow_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_id uuid NOT NULL REFERENCES public.workflow_definitions(id), workflow_version integer NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id), case_id uuid REFERENCES public.cases(id), trigger_type text NOT NULL,
  trigger_reference text NOT NULL, trigger_event_id uuid REFERENCES public.workflow_domain_events(id), status public.workflow_execution_status NOT NULL DEFAULT 'PENDING',
  definition_snapshot jsonb NOT NULL, started_at timestamptz, completed_at timestamptz, failed_node_id uuid, error_metadata jsonb,
  correlation_id uuid NOT NULL, depth integer NOT NULL DEFAULT 0 CHECK(depth BETWEEN 0 AND 16), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workflow_id,trigger_reference), UNIQUE(organization_id,id)
);

CREATE TABLE public.workflow_execution_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_id uuid NOT NULL REFERENCES public.workflow_executions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id), node_id uuid NOT NULL, node_type text NOT NULL, subtype text NOT NULL,
  status public.workflow_execution_status NOT NULL DEFAULT 'PENDING', attempt integer NOT NULL DEFAULT 0, started_at timestamptz,
  completed_at timestamptz, result jsonb NOT NULL DEFAULT '{}', error_metadata jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(execution_id,node_id)
);

CREATE TABLE public.workflow_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_execution_id uuid NOT NULL REFERENCES public.workflow_executions(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.workflow_definitions(id), node_id uuid NOT NULL, organization_id uuid NOT NULL REFERENCES public.organizations(id),
  case_id uuid REFERENCES public.cases(id), trigger_event_id uuid REFERENCES public.workflow_domain_events(id), status public.workflow_job_status NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 20),
  run_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz, locked_by text, last_error text, payload jsonb NOT NULL DEFAULT '{}',
  idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE(organization_id,idempotency_key)
);

CREATE TABLE public.workflow_audits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, workflow_id uuid NOT NULL REFERENCES public.workflow_definitions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id), actor_id uuid REFERENCES public.app_users(id), action text NOT NULL,
  entity_type text NOT NULL, entity_id text, changes jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflow_jobs_claim_idx ON public.workflow_jobs(run_at,created_at) WHERE status IN ('PENDING','WAITING');
CREATE INDEX workflow_executions_history_idx ON public.workflow_executions(workflow_id,created_at DESC);
CREATE INDEX workflow_audits_history_idx ON public.workflow_audits(workflow_id,created_at DESC);
CREATE INDEX workflow_nodes_graph_idx ON public.workflow_nodes(workflow_id);
CREATE INDEX workflow_edges_graph_idx ON public.workflow_edges(workflow_id);

DO $rls$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['workflow_definitions','workflow_nodes','workflow_edges','workflow_versions','workflow_domain_events','workflow_executions','workflow_execution_steps','workflow_jobs','workflow_audits'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON public.%I USING (organization_id=nullif(current_setting(''app.organization_id'',true),'''')::uuid) WITH CHECK (organization_id=nullif(current_setting(''app.organization_id'',true),'''')::uuid)',t||'_tenant',t);
END LOOP; END $rls$;

COMMIT;
