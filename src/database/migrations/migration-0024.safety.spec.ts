import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('migration 0024 safety', () => {
  const sql = readFileSync(
    join(__dirname, '0024-operational-intelligence-core.sql'),
    'utf8',
  );
  it('is transaction wrapped and contains no protected data or destructive DML', () => {
    expect(sql).toMatch(/^--[\s\S]*\bBEGIN;/);
    expect(sql).toMatch(/COMMIT;\s*$/);
    expect(sql).not.toMatch(/VF-2026-8282/i);
    expect(sql).not.toMatch(
      /^\s*(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+|INSERT\s+INTO\s+public\.cases)\b/im,
    );
  });
  it('creates tables idempotently', () => {
    const creates = sql.match(/CREATE TABLE IF NOT EXISTS/g) ?? [];
    expect(creates.length).toBeGreaterThanOrEqual(8);
    expect(sql).not.toMatch(/CREATE TABLE(?! IF NOT EXISTS)/);
  });
  it('enforces organization/case consistency and protects every new table with RLS', () => {
    expect(sql).toContain(
      'FOREIGN KEY (organization_id,case_id) REFERENCES public.cases(organization_id,id)',
    );
    expect(sql).toContain(
      'FOREIGN KEY (organization_id,case_id,source_entity_id)',
    );
    expect(sql).toContain(
      'FOREIGN KEY (organization_id,case_id,depends_on_task_id)',
    );
    expect(sql).toContain(
      'FOREIGN KEY (organization_id,created_by) REFERENCES public.app_users(organization_id,id)',
    );
    expect(sql).toContain('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY vineford_backend_select');
    expect(sql).toContain('CREATE POLICY vineford_backend_insert');
    expect(sql).toContain('CREATE POLICY vineford_backend_update');
    expect(sql).not.toContain('FOR DELETE');
    expect(sql).toContain('REVOKE ALL ON public.%I FROM PUBLIC');
  });
});
