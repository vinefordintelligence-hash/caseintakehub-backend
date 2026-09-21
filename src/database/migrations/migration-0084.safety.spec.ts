import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Fee configuration migration safety', () => {
  const sql = readFileSync(
    join(__dirname, '0084-fee-configuration.sql'),
    'utf8',
  );

  it('limits changes to fee structures', () => {
    expect(sql).toContain('CREATE TABLE public.fee_definitions');
    expect(sql).toContain('CREATE TABLE public.fee_components');
    expect(sql).toContain('CREATE TABLE public.payment_operation_fee_snapshots');
    // Ensure no other tables are created/modified
    const tables = (sql.match(/CREATE\s+TABLE\s+public\.([a-z_]+)/gi) || []).map(t => t.replace(/CREATE\s+TABLE\s+public\./i, ''));
    expect(tables).toHaveLength(3);
    expect(tables).toContain('fee_definitions');
    expect(tables).toContain('fee_components');
    expect(tables).toContain('payment_operation_fee_snapshots');
  });
});
