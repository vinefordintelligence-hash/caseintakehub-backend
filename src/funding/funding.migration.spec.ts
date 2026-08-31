import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Funding & Escrow migration safety', () => {
  const sql = readFileSync(
    join(__dirname, '../database/migrations/0018-funding-and-escrow.sql'),
    'utf8',
  );

  it('is additive and does not target protected production records', () => {
    expect(sql).not.toMatch(/\b(DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/i);
    expect(sql).not.toContain('VF-2026-8282');
    expect(sql).not.toMatch(/ALTER\s+TABLE[\s\S]*DROP\s+COLUMN/i);
  });

  it('separates managed and verified on-chain funding truth', () => {
    expect(sql).toContain("funding_mode IN ('managed', 'on_chain')");
    expect(sql).toContain("network IN ('algorand_testnet')");
    expect(sql).toContain('confirmed_round IS NOT NULL');
    expect(sql).toContain('verified_source text NOT NULL');
  });

  it('provides immutable TrustFund lifecycle history and document links', () => {
    expect(sql).toContain('funding_application_status_history');
    expect(sql).toContain('funding_milestone_status_history');
    expect(sql).toContain('funding_release_status_history');
    expect(sql).toContain('funding_dispute_status_history');
    expect(sql).toContain('funding_supporting_documents');
    expect(sql).toContain('funding_program_reviewers');
    expect(sql).toContain(
      "status IN ('allocation_approved','release_requested','compliance_review','release_authorized','pending_disbursement','disbursed','failed','reversed','cancelled')",
    );
  });
});
