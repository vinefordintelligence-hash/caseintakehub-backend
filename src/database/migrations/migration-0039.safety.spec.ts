import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('transaction authorization fee-availability window migration', () => {
  const sql = readFileSync(
    join(__dirname, '0039-transaction-authorization-fee-availability.sql'),
    'utf8',
  );

  it('is additive and contains no case-specific data or destructive DML', () => {
    expect(sql).toContain(
      'ALTER TABLE public.transaction_authorization_reviews',
    );
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS document_verified_at');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS next_payment_available_at');
    expect(sql).not.toMatch(
      /\b(UPDATE|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|INSERT INTO)\b/i,
    );
    expect(sql).not.toContain('VF-2026-8282');
  });

  it('binds the payment window to the administrator VERIFIED transition', () => {
    expect(sql).toContain('tar_document_verified_requires_window');
    expect(sql).toContain('tar_payment_window_verified_only');
    expect(sql).toContain("document_status = 'VERIFIED'");
  });
});
