import { NotFoundException } from '@nestjs/common';
import { IntakesService } from './intakes.service';
import { CaseReferenceService } from '../cases/case-reference.service';

const references = new CaseReferenceService();

describe('IntakesService', () => {
  it('does not create an intake for an unavailable organization', async () => {
    const service = new IntakesService(
      { query: jest.fn().mockResolvedValue([]) } as any,
      references,
    );
    await expect(
      service.create({
        organization_id: '00000000-0000-4000-8000-000000000001',
        email: 'person@example.test',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hashes resume tokens before database lookup', async () => {
    const data = {
      query: jest.fn().mockResolvedValue([{ id: 'intake', status: 'draft' }]),
    } as any;
    const service = new IntakesService(data, references);
    await service.resume({
      intake_id: '00000000-0000-4000-8000-000000000002',
      token: 'a'.repeat(40),
    });
    expect(data.query.mock.calls[0][1][1]).toMatch(/^[0-9a-f]{64}$/);
    expect(data.query.mock.calls[0][1][1]).not.toContain('a'.repeat(40));
  });

  it('lists intake records only for the verified organization', async () => {
    const data = { query: jest.fn().mockResolvedValue([]) } as any;
    await new IntakesService(data, references).list({
      organizationId: 'verified-org',
      role: 'staff',
    } as any);
    expect(data.query).toHaveBeenCalledWith(
      expect.stringContaining('organization_id=$1'),
      ['verified-org'],
    );
  });

  it('uses the authoritative four-digit generator and provisions hashed portal access during conversion', async () => {
    const queries: string[] = [];
    const runner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        queries.push(sql);
        if (sql.includes('FROM public.case_intakes'))
          return [
            {
              id: 'intake-a',
              organization_id: 'org-a',
              status: 'accepted',
              email: 'client@example.test',
              category: 'Fraud',
              incident_description: 'Narrative',
              metadata: {
                applicant: { first_name: 'Test', last_name: 'Client' },
              },
            },
          ];
        if (sql.includes('FROM public.clients')) return [{ id: 'client-a' }];
        if (sql.includes('INSERT INTO public.app_users'))
          return [{ id: 'client-actor-a' }];
        if (sql.includes('SELECT id FROM public.organization_memberships'))
          return [{ id: 'membership-a' }];
        if (sql.includes('INSERT INTO public.cases'))
          return [{ id: 'case-a', case_number: params?.[2] }];
        return [];
      }),
    };
    const data = { createQueryRunner: jest.fn(() => runner) } as any;
    const service = new IntakesService(data, references);
    const result = await service.convert('intake-a', {
      organizationId: 'org-a',
      actorId: 'admin-a',
      role: 'admin',
    } as any);
    expect(result.case_number).toMatch(/^VF-\d{4}-\d{4}$/);
    expect(result.portal.pin).toMatch(/^\d{6}$/);
    const accessCall = runner.query.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO public.client_case_access'),
    );
    expect(accessCall).toBeDefined();
    expect(String(accessCall?.[1]?.[2])).toMatch(/^\$2[aby]\$12\$/);
    expect(String(accessCall?.[1]?.[2])).not.toBe(result.portal.pin);
    expect(
      queries.some((sql) => sql.includes('INSERT INTO public.app_users')),
    ).toBe(true);
    expect(
      queries.some((sql) =>
        sql.includes('INSERT INTO public.organization_memberships'),
      ),
    ).toBe(true);
    expect(queries).toContain('SAVEPOINT case_reference_attempt');
    expect(queries).toContain('RELEASE SAVEPOINT case_reference_attempt');
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('recovers the intake transaction savepoint before retrying a case-reference collision', async () => {
    const refs = {
      create: jest.fn(
        async (insert: (reference: string) => Promise<unknown>) => {
          try {
            return await insert('VF-2026-1227');
          } catch {
            return insert('VF-2026-4821');
          }
        },
      ),
    };
    let inserts = 0;
    const queries: string[] = [];
    const runner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        queries.push(sql);
        if (sql.includes('FROM public.case_intakes'))
          return [
            {
              id: 'intake-a',
              organization_id: 'org-a',
              status: 'accepted',
              email: 'client@example.test',
              metadata: { applicant: {} },
            },
          ];
        if (sql.includes('FROM public.clients')) return [{ id: 'client-a' }];
        if (sql.includes('INSERT INTO public.app_users'))
          return [{ id: 'client-actor-a' }];
        if (sql.includes('SELECT id FROM public.organization_memberships'))
          return [{ id: 'membership-a' }];
        if (sql.includes('INSERT INTO public.cases')) {
          inserts += 1;
          if (inserts === 1)
            throw Object.assign(new Error('duplicate'), { code: '23505' });
          return [{ id: 'case-a', case_number: params?.[2] }];
        }
        return [];
      }),
    };
    const result = await new IntakesService(
      { createQueryRunner: () => runner } as any,
      refs as any,
    ).convert('intake-a', {
      organizationId: 'org-a',
      actorId: 'admin-a',
      role: 'admin',
    } as any);
    expect(result.case_number).toBe('VF-2026-4821');
    expect(queries).toContain('ROLLBACK TO SAVEPOINT case_reference_attempt');
    expect(inserts).toBe(2);
  });
});
