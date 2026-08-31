BEGIN;

-- End users never connect with this database role. SupabaseIdentityGuard and
-- the scoped services resolve the verified actor, organization, and case
-- before querying. These policies admit only the dedicated backend role,
-- matching the operational-table model introduced in migration 0024.
DO $migration$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['evidence','timeline'] LOOP
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
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=table_name
        AND policyname='vineford_backend_insert'
    ) THEN
      EXECUTE format(
        'CREATE POLICY vineford_backend_insert ON public.%I FOR INSERT TO vineford_app WITH CHECK (true)',
        table_name
      );
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=table_name
        AND policyname='vineford_backend_update'
    ) THEN
      EXECUTE format(
        'CREATE POLICY vineford_backend_update ON public.%I FOR UPDATE TO vineford_app USING (true) WITH CHECK (true)',
        table_name
      );
    END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', table_name);
  END LOOP;
END
$migration$;

GRANT SELECT,INSERT,UPDATE ON public.evidence,public.timeline TO vineford_app;

COMMIT;
