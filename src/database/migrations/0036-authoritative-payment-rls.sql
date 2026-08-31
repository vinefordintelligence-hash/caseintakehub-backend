BEGIN;

-- payments is an authoritative ledger. Client receipt upload is persisted in
-- transaction_authorization_reviews/documents and must never create or verify
-- a payment. Only the authenticated backend role may write this table, and
-- every write must remain tied to one invoice, organization, case proof, and
-- active Admin reviewer.
DROP POLICY IF EXISTS vineford_backend_scoped_insert ON public.payments;
CREATE POLICY vineford_backend_scoped_insert
  ON public.payments
  FOR INSERT
  TO vineford_app
  WITH CHECK (
    verification_status = 'verified'
    AND verified_by IS NOT NULL
    AND verified_at IS NOT NULL
    AND proof_document_id IS NOT NULL
    AND reference_number IS NOT NULL
    AND proof_reference = reference_number
    AND EXISTS (
      SELECT 1
      FROM public.invoices i
      JOIN public.documents d
        ON d.id = payments.proof_document_id
       AND d.organization_id = i.organization_id
       AND d.case_id = i.case_id
      JOIN public.app_users u
        ON u.id = payments.verified_by
       AND u.organization_id = i.organization_id
       AND u.is_active = true
       AND u.role IN ('admin', 'super_admin')
      JOIN public.organization_memberships m
        ON m.app_user_id = u.id
       AND m.organization_id = i.organization_id
       AND m.status = 'active'
       AND m.role IN ('admin', 'super_admin')
      WHERE i.id = payments.invoice_id
        AND i.organization_id = payments.organization_id
        AND i.amount = payments.amount
    )
  );

DROP POLICY IF EXISTS vineford_backend_scoped_update ON public.payments;
CREATE POLICY vineford_backend_scoped_update
  ON public.payments
  FOR UPDATE
  TO vineford_app
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = payments.invoice_id
        AND i.organization_id = payments.organization_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      LEFT JOIN public.documents d
        ON d.id = payments.proof_document_id
       AND d.organization_id = i.organization_id
       AND d.case_id = i.case_id
      LEFT JOIN public.app_users u
        ON u.id = payments.verified_by
       AND u.organization_id = i.organization_id
       AND u.is_active = true
       AND u.role IN ('admin', 'super_admin')
      LEFT JOIN public.organization_memberships m
        ON m.app_user_id = u.id
       AND m.organization_id = i.organization_id
       AND m.status = 'active'
       AND m.role IN ('admin', 'super_admin')
      WHERE i.id = payments.invoice_id
        AND i.organization_id = payments.organization_id
        AND i.amount = payments.amount
        AND (payments.proof_document_id IS NULL OR d.id IS NOT NULL)
        AND (
          payments.verification_status = 'pending'
          OR (u.id IS NOT NULL AND m.app_user_id IS NOT NULL)
        )
    )
  );

COMMIT;
