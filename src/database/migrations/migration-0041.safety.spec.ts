import { readFileSync } from 'fs';
import { join } from 'path';

describe('Migration 0041 — client portal actor repair safety', () => {
  const sql = readFileSync(
    join(__dirname, '0041-client-portal-actor-repair.sql'),
    'utf8',
  );

  it('repairs only missing client actors and memberships', () => {
    expect(sql).toContain('INSERT INTO public.app_users');
    expect(sql).toContain('INSERT INTO public.organization_memberships');
    expect(sql).toMatch(/a\.enabled = true/i);
    expect(sql).toMatch(/existing\.email/i);
    expect(sql).toMatch(/u\.role = 'client'/i);
    expect(sql).toMatch(/u\.is_active = true/i);
  });

  it('does not modify cases, clients, portal credentials, or existing identities', () => {
    expect(sql).not.toMatch(
      /UPDATE\s+public\.(cases|clients|client_case_access|app_users)/i,
    );
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    expect(sql).toMatch(
      /ALTER TABLE public\.app_users\s+DROP CONSTRAINT IF EXISTS app_users_id_fkey/i,
    );
    expect(sql.match(/DROP CONSTRAINT/gi)).toHaveLength(1);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).not.toMatch(/pin_hash\s*=/i);
  });

  it('does not reactivate an existing membership', () => {
    expect(sql).toMatch(/NOT EXISTS\s*\([\s\S]*organization_memberships m/i);
    expect(sql).toMatch(
      /ON CONFLICT \(organization_id, app_user_id\) DO NOTHING/i,
    );
    expect(sql).not.toMatch(/DO UPDATE[\s\S]*status\s*=\s*'active'/i);
  });
});
