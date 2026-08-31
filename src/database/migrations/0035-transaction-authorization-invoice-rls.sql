BEGIN;

-- The authenticated backend creates the Transaction Authorization Review Fee
-- invoice after an administrator verifies the supporting document.  invoices
-- has RLS enabled, but production previously had only a SELECT policy for the
-- vineford_app role, causing the otherwise scoped INSERT to fail with an RLS
-- violation and the whole review transaction to roll back.
--
-- Keep the database boundary case/org/client scoped: the backend may insert an
-- invoice only when all three identifiers describe one persisted case.
DROP POLICY IF EXISTS vineford_backend_scoped_insert ON public.invoices;
CREATE POLICY vineford_backend_scoped_insert
  ON public.invoices
  FOR INSERT
  TO vineford_app
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.cases c
      WHERE c.id = invoices.case_id
        AND c.organization_id = invoices.organization_id
        AND c.client_id = invoices.client_id
    )
  );

COMMIT;
