import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('migration 0028 persistent enabled timers', () => {
  const sql = readFileSync(
    join(__dirname, '0028-persistent-enabled-timers.sql'),
    'utf8',
  );

  it('adds only the two required authoritative timestamps', () => {
    expect(sql).toContain('ALTER TABLE public.case_payments');
    expect(sql).toContain('ALTER TABLE public.organization_settings');
    expect(
      sql.match(/ADD COLUMN IF NOT EXISTS enabled_at timestamptz/g),
    ).toHaveLength(2);
    expect(sql).not.toMatch(
      /DROP\s+TABLE|TRUNCATE|DISABLE ROW LEVEL SECURITY/i,
    );
  });

  it('initializes only already-enabled legacy periods from server timestamps', () => {
    expect(sql).toContain('WHERE gate_enabled=true AND enabled_at IS NULL');
    expect(sql).toContain("setting_key='features.walletConnectionsEnabled'");
    expect(sql).toContain('SET enabled_at=created_at');
    expect(sql).toContain('SET enabled_at=updated_at');
  });

  it('never targets protected case identifiers or creates history', () => {
    expect(sql).not.toMatch(/VF-2026-8282/i);
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
    expect(sql).not.toMatch(
      /public\.(?:cases|messages|invoices|payments|documents|timeline)\b/i,
    );
  });
});
