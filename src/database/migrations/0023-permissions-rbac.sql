-- VINEFORD Module 5: additive, idempotent role-permission persistence.
-- This migration defines authorization policy only. It does not modify cases,
-- client records, financial records, documents, evidence, or workflow history.

BEGIN;

CREATE TABLE IF NOT EXISTS public.permission_definitions (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  permission_key text NOT NULL UNIQUE,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permission_definitions_key_check
    CHECK (permission_key = '*' OR permission_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role public.user_role NOT NULL,
  permission_id uuid NOT NULL REFERENCES public.permission_definitions(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_enabled
  ON public.role_permissions(role, enabled);

INSERT INTO public.permission_definitions(permission_key, description)
VALUES
  ('*', 'All system permissions; reserved for super administrators'),
  ('cases.read', 'Read authorized cases'), ('cases.create', 'Create organization cases'),
  ('cases.update', 'Update authorized cases'), ('cases.assign', 'Assign or transfer cases'),
  ('documents.read', 'Read authorized documents'), ('documents.upload', 'Upload documents'),
  ('documents.verify', 'Verify documents and control visibility'),
  ('evidence.read', 'Read authorized evidence'), ('evidence.manage', 'Create and manage evidence'),
  ('messages.read', 'Read authorized case messages'), ('messages.send', 'Send authorized case messages'),
  ('reports.read', 'Read authorized reports'), ('reports.generate', 'Generate or modify reports'),
  ('audit.read', 'Read organization audit history'), ('audit.write', 'Create administrative audit entries'),
  ('users.read', 'Read authorized user profiles'), ('users.manage', 'Manage organization users'),
  ('organizations.read', 'Read authorized organizations'), ('organizations.manage', 'Manage organizations and settings')
ON CONFLICT(permission_key) DO NOTHING;

WITH grants(role, permission_key) AS (
  VALUES
    ('super_admin','*'),
    ('admin','cases.read'),('admin','cases.create'),('admin','cases.update'),('admin','cases.assign'),
    ('admin','documents.read'),('admin','documents.upload'),('admin','documents.verify'),
    ('admin','evidence.read'),('admin','evidence.manage'),('admin','messages.read'),('admin','messages.send'),
    ('admin','reports.read'),('admin','reports.generate'),('admin','audit.read'),('admin','audit.write'),
    ('admin','users.read'),('admin','users.manage'),('admin','organizations.read'),('admin','organizations.manage'),
    ('investigator','cases.read'),('investigator','cases.create'),('investigator','cases.update'),('investigator','cases.assign'),
    ('investigator','documents.read'),('investigator','documents.upload'),('investigator','documents.verify'),
    ('investigator','evidence.read'),('investigator','evidence.manage'),('investigator','messages.read'),('investigator','messages.send'),
    ('investigator','reports.read'),('investigator','reports.generate'),('investigator','users.read'),('investigator','organizations.read'),
    ('financial_analyst','cases.read'),('financial_analyst','documents.read'),('financial_analyst','evidence.read'),
    ('financial_analyst','messages.read'),('financial_analyst','messages.send'),('financial_analyst','reports.read'),
    ('financial_analyst','reports.generate'),('financial_analyst','users.read'),('financial_analyst','organizations.read'),
    ('staff','cases.read'),('staff','documents.read'),('staff','documents.upload'),('staff','evidence.read'),
    ('staff','messages.read'),('staff','messages.send'),('staff','reports.read'),('staff','users.read'),('staff','organizations.read'),
    ('client','cases.read'),('client','documents.read'),('client','documents.upload'),('client','evidence.read'),
    ('client','messages.read'),('client','messages.send'),('client','reports.read')
)
INSERT INTO public.role_permissions(role, permission_id)
SELECT grants.role::public.user_role, definitions.id
FROM grants JOIN public.permission_definitions definitions USING(permission_key)
ON CONFLICT(role, permission_id) DO NOTHING;

REVOKE ALL ON public.permission_definitions, public.role_permissions FROM PUBLIC;
GRANT SELECT ON public.permission_definitions, public.role_permissions TO vineford_app;
GRANT INSERT, UPDATE ON public.role_permissions TO vineford_app;

COMMIT;
