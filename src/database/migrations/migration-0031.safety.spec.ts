import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('migration 0031 activity email notifications', () => {
  const sql = readFileSync(
    join(__dirname, '0031-activity-email-notifications.sql'),
    'utf8',
  );
  it('is additive and never references the protected case', () => {
    expect(sql).not.toMatch(
      /VF-2026-8282|TRUNCATE|DROP TABLE|DELETE FROM|UPDATE public\.cases/i,
    );
  });
  it('deduplicates jobs and enables forced RLS', () => {
    expect(sql).toMatch(/event_key text NOT NULL UNIQUE/i);
    expect(sql.match(/FORCE ROW LEVEL SECURITY/gi)?.length).toBe(2);
  });
  it('does not copy sensitive audit change values into notification content', () => {
    expect(sql).not.toMatch(
      /NEW\.changes->>'(description|notes|password|pin|token|secret)'/i,
    );
  });
});
