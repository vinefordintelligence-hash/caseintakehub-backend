import { readFileSync } from 'fs';
import { join } from 'path';
describe('0021 admin review state migration', () => {
  const sql = readFileSync(
    join(__dirname, '0021-admin-review-state.sql'),
    'utf8',
  );
  it('is additive and never targets protected or financial records', () => {
    expect(sql).not.toContain('VF-2026-8282');
    expect(sql).not.toMatch(
      /\b(UPDATE|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|INSERT\s+INTO)\b/i,
    );
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS review_status');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS verification_status');
  });
});
