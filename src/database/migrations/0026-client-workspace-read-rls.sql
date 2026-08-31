BEGIN;

-- End users never receive this database role. SupabaseIdentityGuard first
-- verifies the user and binds the actor, organization, and client case; the
-- client-workspace service then includes both case_id and organization_id in
-- every query. These read-only policies restore the backend role's access to
-- legacy rows on postgres-owned RLS tables without adding any write ability.
DO $migration$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['messages','invoices','payments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=table_name
        AND policyname='vineford_backend_select'
    ) THEN
      EXECUTE format(
        'CREATE POLICY vineford_backend_select ON public.%I FOR SELECT TO vineford_app USING (true)',
        table_name
      );
    END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', table_name);
  END LOOP;
END
$migration$;

GRANT SELECT ON public.messages,public.invoices,public.payments TO vineford_app;

COMMIT;
