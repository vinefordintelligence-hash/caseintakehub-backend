import { readFileSync } from 'fs';
import { join } from 'path';

describe('Migration 0012 — safety', () => {
  const sql = readFileSync(
    join(__dirname, '0012-admin-review-payment-gate.sql'),
    'utf8',
  );

  it('15. does not destructively modify existing VF-2026-8282 data tables', () => {
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

    // No unconditional DELETE FROM existing case tables.
    expect(sql).not.toMatch(
      /DELETE\s+FROM\s+public\.(cases|case_transfers|timeline|documents|invoices|payments)\b/i,
    );
    // No existing table/view/sequence is dropped. (DROP TRIGGER on the new
    // tables' update triggers and the intended vf_get_case_workflow function
    // replacement are additive and guarded with IF EXISTS.)
    expect(sql.match(/DROP\s+(TABLE|VIEW|SEQUENCE)/g) ?? []).toHaveLength(0);
    expect(sql).toContain(
      'DROP FUNCTION IF EXISTS public.vf_get_case_workflow(uuid, text)',
    );
  });

  it('15b. migration adds the global gate and per-case payment tables non-destructively', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.payment_gate_settings/,
    );
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.case_payments/);
    // Global gate vs case payment records are separate structures.
    expect(sql).toContain('payment_gate_single_row');
  });
});
