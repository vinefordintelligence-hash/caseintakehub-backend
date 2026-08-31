BEGIN;

ALTER TABLE public.case_client_actions
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL;

ALTER TABLE public.case_client_actions DROP CONSTRAINT IF EXISTS case_client_actions_status_check;
ALTER TABLE public.case_client_actions ADD CONSTRAINT case_client_actions_status_check
  CHECK (status IN ('active','inactive','completed'));

CREATE TABLE IF NOT EXISTS public.client_acceptance_confirmations (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
  client_action_id uuid NOT NULL REFERENCES public.case_client_actions(id) ON DELETE RESTRICT,
  transfer_id uuid NOT NULL REFERENCES public.case_transfers(id) ON DELETE RESTRICT,
  client_actor_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status = 'confirmed'),
  acknowledgement_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_acceptance_action_unique UNIQUE (client_action_id)
);

CREATE INDEX IF NOT EXISTS idx_client_acceptance_case ON public.client_acceptance_confirmations(case_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_acceptance_org ON public.client_acceptance_confirmations(organization_id, accepted_at DESC);
ALTER TABLE public.client_acceptance_confirmations OWNER TO vineford_app;
ALTER TABLE public.client_acceptance_confirmations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vineford_backend_select ON public.client_acceptance_confirmations;
DROP POLICY IF EXISTS vineford_backend_insert ON public.client_acceptance_confirmations;
CREATE POLICY vineford_backend_select ON public.client_acceptance_confirmations FOR SELECT TO vineford_app USING (true);
CREATE POLICY vineford_backend_insert ON public.client_acceptance_confirmations FOR INSERT TO vineford_app WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.vf_get_client_acceptance(
  p_action uuid, p_actor uuid, p_org uuid, p_case uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action public.case_client_actions%ROWTYPE; v_transfer public.case_transfers%ROWTYPE;
  v_count integer; v_name text; v_case_number text; v_accept public.client_acceptance_confirmations%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR p_org IS NULL OR p_case IS NULL OR NOT public.vf_actor_can_access_case(p_actor,p_case) THEN
    RAISE EXCEPTION 'permission denied: authenticated client is not authorized for case';
  END IF;
  SELECT a.* INTO v_action FROM public.case_client_actions a
   WHERE a.id=p_action AND a.case_id=p_case AND a.organization_id=p_org AND a.is_client_visible;
  IF v_action.id IS NULL THEN RAISE EXCEPTION 'acceptance action not found'; END IF;
  IF coalesce(v_action.action_label,'') <> 'Sign Acceptance Confirmation' THEN
    RAISE EXCEPTION 'client action is not an acceptance confirmation';
  END IF;
  SELECT count(*), (array_agg(t.id))[1] INTO v_count, v_transfer.id
    FROM public.case_transfers t
   WHERE t.case_id=p_case AND t.organization_id=p_org
     AND ((v_action.metadata->>'transfer_id')::uuid=t.id
       OR (v_action.metadata->>'transfer_id' IS NULL AND t.transfer_reference IS NOT NULL
         AND position(t.transfer_reference in coalesce(v_action.description,'')) > 0));
  IF v_count <> 1 THEN RAISE EXCEPTION 'acceptance action transfer/reference validation failed'; END IF;
  SELECT * INTO v_transfer FROM public.case_transfers WHERE id=v_transfer.id AND case_id=p_case AND organization_id=p_org;
  SELECT c.case_number, u.name INTO v_case_number, v_name
    FROM public.cases c JOIN public.app_users u ON u.id=p_actor
   WHERE c.id=p_case AND c.organization_id=p_org AND u.role='client' AND u.is_active;
  IF v_case_number IS NULL THEN RAISE EXCEPTION 'permission denied: client ownership validation failed'; END IF;
  SELECT * INTO v_accept FROM public.client_acceptance_confirmations WHERE client_action_id=p_action;
  RETURN jsonb_build_object(
    'action_id',v_action.id,'action_status',v_action.status,'case_id',p_case,'case_reference',v_case_number,
    'organization_id',p_org,'transfer_id',v_transfer.id,'transfer_reference',v_transfer.transfer_reference,
    'authorized_amount',v_transfer.amount,'currency',v_transfer.currency,'authorization_status',v_transfer.status,
    'client_name',v_name,'server_time',now(),'acceptance_status',coalesce(v_accept.status,'required'),
    'accepted_at',v_accept.accepted_at,'acknowledgement_version',coalesce(v_accept.acknowledgement_version,'client_acceptance_v1')
  );
END $$;

CREATE OR REPLACE FUNCTION public.vf_submit_client_acceptance(
  p_action uuid, p_actor uuid, p_org uuid, p_case uuid, p_version text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action public.case_client_actions%ROWTYPE; v_transfer_id uuid; v_count integer;
  v_accept public.client_acceptance_confirmations%ROWTYPE; v_result jsonb;
BEGIN
  IF p_version <> 'client_acceptance_v1' THEN RAISE EXCEPTION 'unsupported acceptance acknowledgement version'; END IF;
  PERFORM public.vf_get_client_acceptance(p_action,p_actor,p_org,p_case);
  SELECT * INTO v_action FROM public.case_client_actions WHERE id=p_action FOR UPDATE;
  SELECT * INTO v_accept FROM public.client_acceptance_confirmations WHERE client_action_id=p_action;
  IF v_accept.id IS NOT NULL THEN
    IF v_accept.client_actor_id<>p_actor OR v_accept.case_id<>p_case OR v_accept.organization_id<>p_org THEN
      RAISE EXCEPTION 'acceptance already belongs to a different authorized scope';
    END IF;
    RETURN public.vf_get_client_acceptance(p_action,p_actor,p_org,p_case);
  END IF;
  IF v_action.status<>'active' OR v_action.activated_at>now() OR (v_action.expires_at IS NOT NULL AND v_action.expires_at<=now()) THEN
    RAISE EXCEPTION 'acceptance action is not ACTIVE';
  END IF;
  SELECT count(*), (array_agg(t.id))[1] INTO v_count,v_transfer_id FROM public.case_transfers t
   WHERE t.case_id=p_case AND t.organization_id=p_org
     AND ((v_action.metadata->>'transfer_id')::uuid=t.id OR (v_action.metadata->>'transfer_id' IS NULL
       AND t.transfer_reference IS NOT NULL AND position(t.transfer_reference in coalesce(v_action.description,''))>0));
  IF v_count<>1 THEN RAISE EXCEPTION 'acceptance action transfer/reference validation failed'; END IF;
  INSERT INTO public.client_acceptance_confirmations
    (organization_id,case_id,client_action_id,transfer_id,client_actor_id,acknowledgement_version)
  VALUES (p_org,p_case,p_action,v_transfer_id,p_actor,p_version) RETURNING * INTO v_accept;
  UPDATE public.case_client_actions SET status='completed',completed_at=v_accept.accepted_at,completed_by=p_actor WHERE id=p_action;
  PERFORM public.vf_append_event(p_case,p_org,'Client acceptance confirmation submitted',
    'The client acceptance confirmation requirement was completed. This confirmation does not execute or guarantee any transfer or withdrawal.',
    'PHASE 6','CLIENT_ACCEPTANCE_CONFIRMED',p_actor,true,v_transfer_id,NULL,NULL,NULL,NULL,NULL,
    jsonb_build_object('acceptance_id',v_accept.id,'client_action_id',p_action,'acknowledgement_version',p_version),v_accept.accepted_at);
  PERFORM public.vf_log_audit(p_org,p_actor,'client_acceptance_confirmation_submitted','client_acceptance_confirmation',v_accept.id,
    jsonb_build_object('case_id',p_case,'client_action_id',p_action,'transfer_id',v_transfer_id,'status','confirmed','acknowledgement_version',p_version));
  INSERT INTO public.audit_logs (organization_id,user_id,action,resource_type,resource_id,case_id,changes)
  VALUES (p_org,p_actor,'client_acceptance_confirmation_submitted','client_acceptance_confirmation',v_accept.id,p_case,
    jsonb_build_object('client_action_id',p_action,'transfer_id',v_transfer_id,'status','confirmed','acknowledgement_version',p_version));
  RETURN public.vf_get_client_acceptance(p_action,p_actor,p_org,p_case);
END $$;

GRANT SELECT,INSERT ON public.client_acceptance_confirmations TO vineford_app;
GRANT UPDATE(completed_at,completed_by,status) ON public.case_client_actions TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_get_client_acceptance(uuid,uuid,uuid,uuid) TO vineford_app;
GRANT EXECUTE ON FUNCTION public.vf_submit_client_acceptance(uuid,uuid,uuid,uuid,text) TO vineford_app;

CREATE OR REPLACE FUNCTION public.vf_submit_withdrawal_after_acceptance(
  p_case uuid,p_actor uuid,p_token text,p_amount numeric,p_currency text,
  p_method text,p_beneficiary text,p_account text,p_account_type text,p_routing text,p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_action uuid; v_result jsonb;
BEGIN
  SELECT a.id INTO v_action
    FROM public.client_acceptance_confirmations ac
    JOIN public.case_client_actions a ON a.id=ac.client_action_id
    JOIN public.case_handoff_grants g ON g.action_id=a.id AND g.case_id=ac.case_id
   WHERE ac.case_id=p_case AND ac.client_actor_id=p_actor AND ac.status='confirmed'
     AND a.status='completed' AND g.purpose='phase6_handoff' AND g.status='active'
     AND (g.expires_at IS NULL OR g.expires_at>now())
   FOR UPDATE OF a;
  IF v_action IS NULL THEN
    RAISE EXCEPTION 'withdrawal request cannot be submitted: acceptance confirmation is required';
  END IF;
  UPDATE public.case_client_actions SET status='active' WHERE id=v_action;
  v_result := public.vf_submit_withdrawal_request(p_case,p_actor,p_token,p_amount,p_currency,
    p_method,p_beneficiary,p_account,p_account_type,p_routing,p_note);
  UPDATE public.case_client_actions SET status='completed' WHERE id=v_action;
  RETURN v_result;
END $$;
GRANT EXECUTE ON FUNCTION public.vf_submit_withdrawal_after_acceptance(uuid,uuid,text,numeric,text,text,text,text,text,text,text) TO vineford_app;

COMMIT;
