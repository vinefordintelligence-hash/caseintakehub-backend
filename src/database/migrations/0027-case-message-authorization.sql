BEGIN;

CREATE OR REPLACE FUNCTION public.vf_actor_can_access_case(p_actor uuid, p_case uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_role public.user_role;
  v_org uuid;
  v_case_org uuid;
BEGIN
  IF p_actor IS NULL OR p_case IS NULL THEN RETURN false; END IF;

  SELECT role,organization_id INTO v_role,v_org
  FROM public.app_users WHERE id=p_actor AND is_active=true;
  SELECT organization_id INTO v_case_org FROM public.cases WHERE id=p_case;
  IF v_role IS NULL OR v_case_org IS NULL OR v_org IS DISTINCT FROM v_case_org THEN
    RETURN false;
  END IF;

  IF v_role='client' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.cases c
      JOIN public.clients cl ON cl.id=c.client_id AND cl.organization_id=c.organization_id
      JOIN public.client_case_access cca ON cca.case_id=c.id AND cca.client_id=cl.id AND cca.enabled=true
      JOIN public.app_users u ON u.id=p_actor AND u.organization_id=c.organization_id
      WHERE c.id=p_case AND lower(u.email)=lower(cl.email)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.app_user_id=p_actor AND m.organization_id=v_case_org AND m.status='active'
  ) THEN RETURN false; END IF;

  IF v_role IN ('super_admin','admin') THEN RETURN true; END IF;

  IF v_role IN ('investigator','financial_analyst','staff') THEN
    RETURN EXISTS (
      SELECT 1 FROM public.case_assignments a
      WHERE a.case_id=p_case AND a.organization_id=v_case_org
        AND a.app_user_id=p_actor AND a.active=true
    );
  END IF;

  RETURN false;
END
$function$;

REVOKE ALL ON FUNCTION public.vf_actor_can_access_case(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vf_actor_can_access_case(uuid,uuid) TO vineford_app;

COMMIT;
