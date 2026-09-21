import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Add is-active to fee components migration safety', () => {
  const sql = readFileSync(
    join(__dirname, '0085-add-is-active-to-fee-components.sql'),
    'utf8',
  );

  it('limits changes to fee_components.is_active', () => {
    expect(sql).toContain('ALTER TABLE public.fee_components ADD COLUMN is_active');
    expect(sql).toContain('BOOLEAN');
    // Ensure no other tables are altered
    expect(sql.match(/ALTER\s+TABLE/gi)).toHaveLength(1);
    expect(sql.match(/ADD\s+COLUMN/gi)).toHaveLength(1);
    expect(sql).not.toContain('DROP');
    expect(sql).not.toContain('DELETE');
  });
});
