import { readFileSync } from 'fs';
import { join } from 'path';
describe('case progress migration', () => {
  const sql = readFileSync(
    join(__dirname, '../database/migrations/0020-case-progress-control.sql'),
    'utf8',
  );
  it('is additive and never targets protected records', () => {
    expect(sql).not.toMatch(
      /\b(UPDATE|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/i,
    );
    expect(sql).not.toContain('VF-2026-8282');
    expect(sql).toContain('investigation_progress_percent');
    expect(sql).toContain('lead_investigator_user_id');
    expect(sql).toContain('gate_enabled');
  });
});
