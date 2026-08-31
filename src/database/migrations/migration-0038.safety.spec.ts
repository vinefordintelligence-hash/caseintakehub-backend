import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('transaction authorization receiving-bank migration', () => {
  const sql = readFileSync(
    join(__dirname, '0038-transaction-authorization-receiving-bank.sql'),
    'utf8',
  );

  it('is additive and contains no case-specific data or destructive DML', () => {
    expect(sql).toContain(
      'ALTER TABLE public.transaction_authorization_reviews',
    );
    expect(sql).not.toMatch(
      /\b(UPDATE|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/i,
    );
    expect(sql).not.toContain('VF-2026-8282');
  });
});
