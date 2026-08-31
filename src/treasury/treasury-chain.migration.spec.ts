import { readFileSync } from 'node:fs';
import { join } from 'node:path';
describe('Treasury chain migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../database/migrations/0019-treasury-chain-deposits-withdrawals.sql',
    ),
    'utf8',
  );
  it('is additive and contains exactly-once constraints', () => {
    expect(sql).not.toMatch(
      /\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM)\b/i,
    );
    expect(sql).toContain(
      'UNIQUE(network,transaction_hash,asset,output_index,destination_address)',
    );
    expect(sql).toContain("WHERE source_type='blockchain_deposit'");
    expect(sql).toContain('approved_by <> requested_by');
  });
});
