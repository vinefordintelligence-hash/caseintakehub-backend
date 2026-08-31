import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('migration 0025 evidence/timeline backend RLS', () => {
  const sql = readFileSync(
    join(__dirname, '0025-evidence-timeline-backend-rls.sql'),
    'utf8',
  );

  it('limits policies to the dedicated backend role and preserves RLS', () => {
    expect(sql).toContain("ARRAY['evidence','timeline']");
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('TO vineford_app');
    expect(sql).toContain('REVOKE ALL ON public.%I FROM PUBLIC');
    expect(sql).not.toContain('DISABLE ROW LEVEL SECURITY');
  });

  it('does not mutate protected or production case data', () => {
    expect(sql).not.toMatch(/VF-2026-8282/i);
    expect(sql).not.toMatch(
      /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*public\.cases/i,
    );
    expect(sql).not.toMatch(/DROP\s+TABLE|TRUNCATE/i);
  });
});
