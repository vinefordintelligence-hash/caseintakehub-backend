ALTER TYPE public.workflow_job_status ADD VALUE IF NOT EXISTS 'FAILED' AFTER 'COMPLETED';

ALTER TABLE public.workflow_nodes DROP CONSTRAINT IF EXISTS workflow_nodes_node_type_check;
ALTER TABLE public.workflow_nodes ADD CONSTRAINT workflow_nodes_node_type_check
  CHECK (node_type IN ('TRIGGER','CONDITION','ACTION','WAIT','END'));

CREATE TABLE public.workflow_action_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  execution_id uuid NOT NULL REFERENCES public.workflow_executions(id) ON DELETE CASCADE,
  node_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,idempotency_key)
);

CREATE INDEX workflow_action_effects_execution_idx
  ON public.workflow_action_effects(execution_id,node_id);

ALTER TABLE public.workflow_action_effects ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_action_effects_tenant ON public.workflow_action_effects
  USING (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid)
  WITH CHECK (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
