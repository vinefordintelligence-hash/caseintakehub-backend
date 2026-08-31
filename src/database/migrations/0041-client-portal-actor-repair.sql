-- Add the client actor identity required by client portal authorization for
-- enabled case access records created before intake conversion provisioned it.
-- This migration never changes cases, clients, case references, emails, PIN
-- hashes, lockouts, or portal access state.

BEGIN;

-- app_users is Vineford's internal actor directory. Supabase identities are
-- linked explicitly through vf_identity_links; the legacy direct auth.users
-- foreign key conflicts with that model and with UsersService-generated actor
-- UUIDs. Removing it does not remove Supabase token or identity-link checks.
ALTER TABLE public.app_users
  DROP CONSTRAINT IF EXISTS app_users_id_fkey;

WITH eligible AS (
  SELECT DISTINCT ON (lower(cl.email))
         c.organization_id,
         cl.name,
         lower(cl.email) AS email
    FROM public.client_case_access a
    JOIN public.cases c
      ON c.id = a.case_id
     AND c.client_id = a.client_id
    JOIN public.clients cl
      ON cl.id = c.client_id
     AND cl.organization_id = c.organization_id
   WHERE a.enabled = true
     AND NOT EXISTS (
       SELECT 1
         FROM public.app_users existing
        WHERE lower(existing.email) = lower(cl.email)
     )
     AND 1 = (
       SELECT count(DISTINCT c2.organization_id)
         FROM public.cases c2
         JOIN public.clients cl2 ON cl2.id = c2.client_id
        WHERE lower(cl2.email) = lower(cl.email)
     )
   ORDER BY lower(cl.email), c.created_at ASC
), inserted AS (
  INSERT INTO public.app_users
    (id, organization_id, name, email, role, is_active)
  SELECT public.uuid_generate_v4(), organization_id, name, email, 'client', true
    FROM eligible
  RETURNING id, organization_id
)
INSERT INTO public.organization_memberships
  (organization_id, app_user_id, role, status)
SELECT organization_id, id, 'client', 'active'
  FROM inserted
ON CONFLICT (organization_id, app_user_id) DO NOTHING;

-- Existing active client actors may predate organization membership. Add only
-- a missing membership; never reactivate or rewrite an existing membership.
INSERT INTO public.organization_memberships
  (organization_id, app_user_id, role, status)
SELECT DISTINCT c.organization_id, u.id, 'client', 'active'
  FROM public.client_case_access a
  JOIN public.cases c
    ON c.id = a.case_id
   AND c.client_id = a.client_id
  JOIN public.clients cl
    ON cl.id = c.client_id
   AND cl.organization_id = c.organization_id
  JOIN public.app_users u
    ON lower(u.email) = lower(cl.email)
   AND u.organization_id = c.organization_id
   AND u.role = 'client'
   AND u.is_active = true
 WHERE a.enabled = true
   AND NOT EXISTS (
     SELECT 1
       FROM public.organization_memberships m
      WHERE m.organization_id = c.organization_id
        AND m.app_user_id = u.id
   )
ON CONFLICT (organization_id, app_user_id) DO NOTHING;

COMMIT;
