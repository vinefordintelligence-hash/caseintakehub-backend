import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SYSTEM_PERMISSION_MATRIX } from '../../permissions/permissions.service';

describe('migration 0023 permission persistence safety', () => {
  const sql = readFileSync(
    join(__dirname, '0023-permissions-rbac.sql'),
    'utf8',
  );

  it('is additive and does not target protected operational records', () => {
    expect(sql).toMatch(/\bBEGIN;/);
    expect(sql).toMatch(/COMMIT;\s*$/);
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS public.permission_definitions',
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.role_permissions');
    expect(sql).toContain('DEFAULT public.uuid_generate_v4()');
    expect(sql).not.toMatch(
      /\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM)\b/i,
    );
    expect(sql).not.toContain('VF-2026-8282');
    expect(sql).not.toMatch(
      /(?:INSERT INTO|UPDATE) public\.(?:cases|documents|evidence|payments|messages|timeline_events)/i,
    );
  });

  it('uses the existing database role type and protects super-admin wildcard mapping', () => {
    expect(sql).toContain('role public.user_role NOT NULL');
    expect(sql).toContain("('super_admin','*')");
    expect(sql).toContain('ON CONFLICT(role, permission_id) DO NOTHING');
  });

  it('seeds exactly the source-level permission matrix without broader grants', () => {
    const grantsSql = sql.slice(
      sql.indexOf('WITH grants'),
      sql.indexOf('INSERT INTO public.role_permissions'),
    );
    const seeded = [
      ...grantsSql.matchAll(
        /\('(super_admin|admin|investigator|financial_analyst|staff|client)','([^']+)'\)/g,
      ),
    ]
      .map((match) => `${match[1]}:${match[2]}`)
      .sort();
    const expected = Object.entries(SYSTEM_PERMISSION_MATRIX)
      .flatMap(([role, permissions]) =>
        permissions.map((permission) => `${role}:${permission}`),
      )
      .sort();
    expect(seeded).toEqual(expected);
  });
});
