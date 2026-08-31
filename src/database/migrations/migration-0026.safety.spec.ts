import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('migration 0026 client-workspace read RLS', () => {
  const sql = readFileSync(
    join(__dirname, '0026-client-workspace-read-rls.sql'),
    'utf8',
  );

  it('grants only backend SELECT access to the three affected RLS tables', () => {
    expect(sql).toContain("ARRAY['messages','invoices','payments']");
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FOR SELECT TO vineford_app USING (true)');
    expect(sql).toContain('REVOKE ALL ON public.%I FROM PUBLIC');
    expect(sql).toContain(
      'GRANT SELECT ON public.messages,public.invoices,public.payments TO vineford_app',
    );
    expect(sql).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)/i);
    expect(sql).not.toContain('DISABLE ROW LEVEL SECURITY');
  });

  it('does not mutate cases or historical module data', () => {
    expect(sql).not.toMatch(/VF-2026-8282/i);
    expect(sql).not.toMatch(
      /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*public\.(?:cases|messages|invoices|payments)/i,
    );
    expect(sql).not.toMatch(/DROP\s+TABLE|TRUNCATE/i);
  });
});
