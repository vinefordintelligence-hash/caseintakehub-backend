import { readFileSync } from 'fs';
import { join } from 'path';

describe('Migration 0014 — safety', () => {
  const sql = readFileSync(
    join(__dirname, '0014-withdrawal-requests.sql'),
    'utf8',
  );

  it('17. does not destructively modify existing VF-2026-8282 data tables', () => {
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
      'case_handoff_grants',
      'messages',
      'app_users',
      'clients',
      'organizations',
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
      /DELETE\s+FROM\s+public\.(cases|case_transfers|timeline|documents|invoices|payments|case_client_actions|case_handoff_grants|messages)\b/i,
    );
    expect(sql.match(/DROP\s+(TABLE|VIEW|SEQUENCE)/g) ?? []).toHaveLength(0);
  });

  it('17b. migration adds the withdrawal request table and functions non-destructively', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.case_withdrawal_requests/,
    );
    for (const fn of [
      'vf_withdrawal_status_label',
      'vf_actor_can_access_case',
      'vf_submit_withdrawal_request',
      'vf_get_withdrawal_request',
      'vf_get_case_withdrawal_requests',
      'vf_list_withdrawal_requests',
      'vf_admin_withdrawal_decision',
      'vf_respond_to_withdrawal_request',
      'vf_send_case_message',
      'vf_get_case_messages',
    ]) {
      expect(sql).toMatch(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`),
      );
    }
    // Read-model redefinition is additive and guarded.
    expect(sql).toContain(
      'DROP FUNCTION IF EXISTS public.vf_get_case_workflow(uuid, text)',
    );
    expect(sql).toMatch(/SECURITY DEFINER/);
    // Decisions and funds handling are gated.
    expect(sql).toContain('vf_require_admin');
    expect(sql).toMatch(
      /no real financial transfer|never executes|executed', false/,
    );
  });

  it('17c. migration keeps the downstream flow explicitly SANDBOX / DEMO', () => {
    expect(sql).toContain("'sandbox', true");
    expect(sql).toContain("'simulated', true");
    expect(sql).toMatch(
      /SANDBOX \/ DEMO workflow\. This is simulated functionality only/,
    );
    // Approval path must never execute a financial transfer.
    expect(sql).toContain("'executed', false");
  });
});
