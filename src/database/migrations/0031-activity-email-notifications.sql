BEGIN;

CREATE TABLE IF NOT EXISTS public.activity_notification_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  recipient_email text,
  categories jsonb NOT NULL DEFAULT '{"intake":true,"case":true,"client_portal":true,"kyc":true,"documents":true,"messages":true,"financial":true,"security":true,"administration":true}'::jsonb,
  delivery_mode text NOT NULL DEFAULT 'immediate' CHECK (delivery_mode IN ('immediate','digest')),
  updated_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_notification_recipient_email CHECK (recipient_email IS NULL OR recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

CREATE TABLE IF NOT EXISTS public.activity_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  category text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  actor_type text,
  actor_name text,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  case_number text,
  entity_type text NOT NULL,
  entity_id text,
  entity_reference text,
  title text NOT NULL,
  description text NOT NULL,
  activity_status text,
  delivery_status text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','processing','sent','failed','skipped')),
  recipient_email text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_notification_outbox_delivery_idx
  ON public.activity_notification_outbox(delivery_status,next_attempt_at,created_at);
CREATE INDEX IF NOT EXISTS activity_notification_outbox_org_idx
  ON public.activity_notification_outbox(organization_id,created_at DESC);

ALTER TABLE public.activity_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_notification_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.activity_notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_notification_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_notification_settings FROM PUBLIC;
REVOKE ALL ON public.activity_notification_outbox FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON public.activity_notification_settings TO vineford_app;
GRANT SELECT,INSERT,UPDATE ON public.activity_notification_outbox TO vineford_app;

DROP POLICY IF EXISTS activity_notification_settings_app ON public.activity_notification_settings;
CREATE POLICY activity_notification_settings_app ON public.activity_notification_settings
  FOR ALL TO vineford_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS activity_notification_outbox_app ON public.activity_notification_outbox;
CREATE POLICY activity_notification_outbox_app ON public.activity_notification_outbox
  FOR ALL TO vineford_app USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.enqueue_activity_notification_from_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  normalized text := lower(NEW.action);
  category_name text;
  safe_title text;
BEGIN
  IF normalized !~ '(intake|assessment|case_|client_auth|client_portal|kyc|document|evidence|message|invoice|payment|funding|treasury|transfer|withdraw|user_|role_|permission|organization|security|configuration|feature_toggle)' THEN
    RETURN NEW;
  END IF;
  category_name := CASE
    WHEN normalized ~ '(intake|assessment)' THEN 'intake'
    WHEN normalized ~ '^case_' THEN 'case'
    WHEN normalized ~ '(client_auth|client_portal)' THEN 'client_portal'
    WHEN normalized ~ 'kyc' THEN 'kyc'
    WHEN normalized ~ '(document|evidence)' THEN 'documents'
    WHEN normalized ~ 'message' THEN 'messages'
    WHEN normalized ~ '(invoice|payment|funding|treasury|transfer|withdraw)' THEN 'financial'
    WHEN normalized ~ '(security|login_failed)' THEN 'security'
    ELSE 'administration'
  END;
  safe_title := initcap(replace(replace(NEW.action,'.',' '),'_',' '));
  INSERT INTO public.activity_notification_outbox(
    event_key,event_type,category,occurred_at,organization_id,actor_id,case_id,
    entity_type,entity_id,title,description,activity_status)
  VALUES(
    'audit:'||NEW.id::text,NEW.action,category_name,NEW.created_at,NEW.organization_id,NEW.user_id,NEW.case_id,
    NEW.resource_type,NEW.resource_id::text,safe_title,'A meaningful activity was recorded in VINEFORD.',
    CASE WHEN jsonb_typeof(NEW.changes)='object' THEN coalesce(NEW.changes->>'status',NEW.changes->>'to_status') END)
  ON CONFLICT(event_key) DO NOTHING;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_activity_notification_from_audit() FROM PUBLIC;
DROP TRIGGER IF EXISTS audit_log_activity_notification ON public.audit_logs;
CREATE TRIGGER audit_log_activity_notification
AFTER INSERT ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.enqueue_activity_notification_from_audit();

COMMIT;
