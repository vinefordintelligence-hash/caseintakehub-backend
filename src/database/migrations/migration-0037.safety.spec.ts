import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('payment gate supporting verification migration', () => {
  const sql = readFileSync(
    join(__dirname, '0037-payment-gate-supporting-verification.sql'),
    'utf8',
  );

  it('only extends the existing transaction authorization model', () => {
    expect(sql).toContain(
      'ALTER TABLE public.transaction_authorization_reviews',
    );
    expect(sql).toContain('supporting_verification_required');
    expect(sql).toContain('accepted_document_type');
    expect(sql).not.toMatch(
      /CREATE TABLE|DROP TABLE|DELETE FROM|UPDATE public\.cases/i,
    );
  });

  it('supports voided check, divorce document, and either', () => {
    expect(sql).toContain("'VOIDED_CHECK','DIVORCE_DOCUMENT','EITHER'");
  });
});
