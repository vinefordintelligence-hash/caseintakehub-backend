import { readFileSync } from 'fs';
import { join } from 'path';

describe('Migration 0013 — safety', () => {
  const sql = readFileSync(
    join(__dirname, '0013-phase6-handoff-grant.sql'),
    'utf8',
  );

  it('16. does not destructively modify existing VF-2026-8282 data tables', () => {
    const existingTables = [
      'cases',
      'case_transfers',
      'transfer_document_requirements',
      'timeline',
      'documents',
      'audit_logs',
      'invoices',
      'payments',
      'document_requests',
      'engagement_signatures',
      'case_client_actions',
      'payment_gate_settings',
      'case_payments',
    ];

    for (const table of existingTables) {
      expect(sql).not.toMatch(
        new RegExp(
          `DROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?public\\.${table}`,
          'i',
        ),
      );
      expect(sql).not.toMatch(new RegExp(`TRUNCATE\\s+public\\.${table}`, 'i'));
    }

    expect(sql).not.toMatch(
      /DELETE\s+FROM\s+public\.(cases|case_transfers|timeline|documents|invoices|payments|case_client_actions|case_handoff_grants)\b/i,
    );
    expect(sql.match(/DROP\s+(TABLE|VIEW|SEQUENCE)/g) ?? []).toHaveLength(0);
  });

  it('16b. migration adds the handoff grant table and functions non-destructively', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.case_handoff_grants/,
    );
    for (const fn of [
      'vf_issue_phase6_handoff',
      'vf_store_phase6_handoff_token',
      'vf_verify_phase6_handoff',
      'vf_revoke_phase6_handoff',
      'vf_get_phase6_handoff_status',
    ]) {
      expect(sql).toMatch(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`),
      );
    }
    // The read-model redefinition is additive and guarded.
    expect(sql).toContain(
      'DROP FUNCTION IF EXISTS public.vf_get_case_workflow(uuid, text)',
    );
    // Authorization-based: Phase 6 never opens because a URL is known —
    // a signed token must be presented and re-validated against live state.
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toContain('token does not match grant');
  });

  it('16c. migration keeps the downstream flow explicitly SANDBOX / DEMO', () => {
    expect(sql).toContain("'sandbox', true");
    expect(sql).toContain("'simulated', true");
    expect(sql).toMatch(
      /SANDBOX \/ DEMO workflow\. This is simulated functionality only/,
    );
  });
});
