import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('client acceptance confirmation migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../database/migrations/0034-client-acceptance-confirmation.sql',
    ),
    'utf8',
  );

  it('binds one acceptance to actor, organization, case, action, and transfer', () => {
    expect(sql).toContain('client_acceptance_action_unique');
    expect(sql).toContain('client_actor_id');
    expect(sql).toContain('organization_id');
    expect(sql).toContain('client_action_id');
    expect(sql).toContain('transfer_id');
    expect(sql).toContain("v_action.status<>'active'");
  });

  it('requires acceptance before withdrawal and preserves completed state', () => {
    expect(sql).toContain('vf_submit_withdrawal_after_acceptance');
    expect(sql).toContain('acceptance confirmation is required');
    expect(sql).toContain("SET status='completed'");
  });

  it('does not target the protected case or alter financial state', () => {
    expect(sql).not.toContain('VF-2026-8282');
    expect(sql).not.toMatch(
      /UPDATE\s+public\.(case_transfers|payments|case_payments|treasury_accounts)/i,
    );
    expect(sql).not.toMatch(
      /INSERT\s+INTO\s+public\.(payments|case_payments)/i,
    );
  });
});
