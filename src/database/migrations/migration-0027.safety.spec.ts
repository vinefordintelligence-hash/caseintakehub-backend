import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('migration 0027 case-message authorization', () => {
  const sql = readFileSync(
    join(__dirname, '0027-case-message-authorization.sql'),
    'utf8',
  );

  it('checks organization membership before staff role or assignment access', () => {
    expect(sql).toContain('v_org IS DISTINCT FROM v_case_org');
    expect(sql).toContain("m.status='active'");
    expect(sql.indexOf('v_org IS DISTINCT FROM v_case_org')).toBeLessThan(
      sql.indexOf("v_role IN ('super_admin','admin')"),
    );
    expect(sql.indexOf("m.status='active'")).toBeLessThan(
      sql.indexOf("v_role IN ('super_admin','admin')"),
    );
    expect(sql).toContain('a.organization_id=v_case_org');
    expect(sql).toContain('a.active=true');
  });

  it('keeps client access bound to the enabled client/case relationship', () => {
    expect(sql).toContain('cca.case_id=c.id');
    expect(sql).toContain('cca.client_id=cl.id');
    expect(sql).toContain('cca.enabled=true');
    expect(sql).toContain('lower(u.email)=lower(cl.email)');
  });

  it('does not modify case or historical records and limits function execution', () => {
    expect(sql).not.toMatch(/VF-2026-8282/i);
    expect(sql).not.toMatch(
      /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*public\.(?:cases|messages|invoices|payments)/i,
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.vf_actor_can_access_case(uuid,uuid) FROM PUBLIC',
    );
    expect(sql).toContain('TO vineford_app');
  });
});
