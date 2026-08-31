-- ============================================================
-- 0015 — CLIENT CASE ACCESS (Reference ID + Email + 6-digit PIN)
-- Target DB : vineford_intake_test
--
-- Adds per-case client portal authentication on top of the
-- existing Phase 1–6 workflow and the Phase 6 authorization
-- handoff (0013/0014). This migration is additive only:
--   * public.client_case_access — one access record PER CASE,
--     bound to that case's authorized client. Stores a bcrypt
--     PIN hash (never the raw PIN), per-case attempt/lock state,
--     and an explicit `enabled` flag.
--
-- No existing table is dropped, truncated or altered. No existing
-- row is updated or deleted. VF-2026-8282 and every other case are
-- preserved byte-for-byte. Records in client_case_access are only
-- created by provisioning (a separate operation), never by this
-- migration.
--
-- Run as: postgres superuser.
-- ============================================================

BEGIN;

-- ── 1. Per-case client access record ──────────────────────────
CREATE TABLE IF NOT EXISTS public.client_case_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  pin_attempts integer NOT NULL DEFAULT 0,
  pin_locked_until timestamptz,
  enabled boolean NOT NULL DEFAULT false,
  pin_set_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_client_case_access_case_id UNIQUE (case_id)
);

CREATE INDEX IF NOT EXISTS idx_client_case_access_client_id
  ON public.client_case_access (client_id);

DROP TRIGGER IF EXISTS trigger_update_client_case_access_updated_at
  ON public.client_case_access;
CREATE TRIGGER trigger_update_client_case_access_updated_at
  BEFORE UPDATE ON public.client_case_access
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
