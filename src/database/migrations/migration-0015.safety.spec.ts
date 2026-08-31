import { readFileSync } from 'fs';
import { join } from 'path';

describe('Migration 0015 — safety', () => {
  const sql = readFileSync(
    join(__dirname, '0015-client-case-auth.sql'),
    'utf8',
  );

  it('9. does not destructively modify existing VF-2026-8282 data tables', () => {
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
      'case_withdrawal_requests',
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
      expect(sql).not.toMatch(
        new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}`, 'i'),
      );
    }

    expect(sql).not.toMatch(
      /DELETE\s+FROM\s+public\.(cases|case_transfers|timeline|documents|invoices|payments|case_client_actions|case_handoff_grants|messages|clients|app_users|case_withdrawal_requests)\b/i,
    );
    expect(sql.match(/DROP\s+(TABLE|VIEW|SEQUENCE)/g) ?? []).toHaveLength(0);
  });

  it('9b. migration adds the per-case client access table non-destructively', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.client_case_access/,
    );
    expect(sql).toMatch(/pin_hash text NOT NULL/);
    expect(sql).toMatch(/pin_attempts integer NOT NULL DEFAULT 0/);
    expect(sql).toMatch(/pin_locked_until timestamptz/);
    expect(sql).toMatch(/enabled boolean NOT NULL DEFAULT false/);
    expect(sql).toMatch(
      /CONSTRAINT uq_client_case_access_case_id UNIQUE \(case_id\)/,
    );
    // The raw PIN must never be persisted by this migration.
    expect(sql).not.toMatch(/pin\s+(text|varchar)\s+NOT NULL/i);
    expect(sql).not.toMatch(/password/i);
  });

  it('9c. migration only touches the new table (no UPDATE on existing data)', () => {
    const updateStatements = sql.match(/UPDATE\s+public\.(\w+)/gi) ?? [];
    for (const statement of updateStatements) {
      expect(statement.toLowerCase()).toBe('update public.client_case_access');
    }
    const insertStatements = sql.match(/INSERT\s+INTO\s+public\.(\w+)/gi) ?? [];
    expect(insertStatements).toHaveLength(0);
  });
});
