import { readFileSync } from 'fs';
import { join } from 'path';
describe('0022 payment proof document migration', () => {
  const sql = readFileSync(
    join(__dirname, '0022-payment-proof-document.sql'),
    'utf8',
  );
  it('is additive and never targets protected or payment records', () => {
    expect(sql).not.toContain('VF-2026-8282');
    expect(sql).not.toMatch(
      /\b(UPDATE|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|INSERT\s+INTO)\b/i,
    );
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS proof_document_id');
    expect(sql).toContain('REFERENCES public.documents(id)');
  });
});
