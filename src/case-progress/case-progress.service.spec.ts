import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CaseProgressService } from './case-progress.service';

const admin = {
  actorId: 'actor-a',
  organizationId: 'org-a',
  role: 'super_admin',
  supabaseUserId: 'sup-a',
};
const client = {
  ...admin,
  actorId: 'client-a',
  role: 'client',
  caseId: 'case-a',
};
const baseCase = {
  id: 'case-a',
  case_number: 'VF-TEST-1',
  organization_id: 'org-a',
  client_id: 'client-a',
  status: 'open',
  title: 'Fixture',
  investigation_progress_percent: 20,
  lead_investigator_user_id: null,
  estimated_next_step: null,
};

function harness(
  overrides: { caseRow?: Record<string, unknown> | null; staff?: boolean } = {},
) {
  const calls: string[] = [];
  let payment: Record<string, unknown> | undefined;
  let currentCase: Record<string, unknown> = {
    ...baseCase,
    ...(overrides.caseRow ?? {}),
  };
  const manager = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push(sql);
      if (sql.includes('SELECT c.*'))
        return overrides.caseRow === null
          ? []
          : [{ ...currentCase, server_time: '2026-08-25T00:00:00.000Z' }];
      if (
        sql.includes('lead investigator must') ||
        sql.includes('SELECT u.id,u.name FROM')
      )
        return overrides.staff === false
          ? []
          : [{ id: params?.[0], name: 'Investigator' }];
      if (sql.includes('SELECT id,name FROM public.investigators'))
        return overrides.staff === false
          ? []
          : [{ id: params?.[0], name: 'Directory Investigator' }];
      if (sql.includes('UPDATE public.cases')) {
        currentCase = {
          ...currentCase,
          investigation_progress_percent:
            params?.[2] ?? currentCase.investigation_progress_percent,
          lead_investigator_user_id: params?.[3]
            ? params?.[4]
            : currentCase.lead_investigator_user_id,
          assigned_investigator_id: params?.[5]
            ? params?.[6]
            : currentCase.assigned_investigator_id,
          estimated_next_step: params?.[7]
            ? params?.[8]
            : currentCase.estimated_next_step,
        };
        return [currentCase];
      }
      if (sql.includes('INSERT INTO public.case_payments')) {
        payment = {
          gate_enabled: true,
          payment_title: 'Review Fee',
          payment_description: null,
          amount: 100,
          currency: 'USD',
          blocks_progress: true,
          status: 'required',
        };
        return [];
      }
      if (sql.includes('SELECT gate_enabled,payment_title'))
        return payment ? [payment] : [];
      if (sql.includes('SELECT cp.*,EXISTS'))
        return payment
          ? [{ ...payment, has_authoritative_payment: false }]
          : [];
      if (
        sql.includes('lead_investigator_options') ||
        sql.includes('SELECT u.id,u.name,u.role')
      )
        return [];
      return [];
    }),
  };
  const db = {
    query: jest.fn(),
    transaction: jest.fn(async (fn: (m: typeof manager) => unknown) =>
      fn(manager),
    ),
  };
  return { service: new CaseProgressService(db as never), manager, db, calls };
}

describe('CaseProgressService', () => {
  it.each([-1, 101, 37.5])('rejects invalid progress %s', async (value) => {
    const { service } = harness();
    await expect(
      service.update(
        'case-a',
        { investigation_progress_percent: value },
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([0, 100])(
    'persists boundary progress %s and audits the save',
    async (value) => {
      const { service, calls } = harness();
      const result = await service.update(
        'case-a',
        { investigation_progress_percent: value },
        admin,
      );
      expect(result.investigation_progress_percent).toBe(value);
      expect(
        calls.some((sql) => sql.includes('INSERT INTO public.audit_logs')),
      ).toBe(true);
    },
  );
  it('rejects a client update', async () => {
    const { service } = harness();
    await expect(
      service.update('case-a', { investigation_progress_percent: 50 }, client),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects cross-organization or unknown cases', async () => {
    const { service } = harness({ caseRow: null });
    await expect(
      service.update('case-a', { investigation_progress_percent: 50 }, admin),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejects an inactive or invalid lead investigator', async () => {
    const { service } = harness({ staff: false });
    await expect(
      service.update(
        'case-a',
        { lead_investigator_user_id: '11111111-1111-4111-8111-111111111111' },
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('preserves a selected organization-scoped investigator directory relationship', async () => {
    const { service } = harness();
    const id = '22222222-2222-4222-8222-222222222222';
    const result = await service.update(
      'case-a',
      { lead_investigator_selection: `investigator:${id}` },
      admin,
    );
    expect(result.lead_investigator_selection).toBe(`investigator:${id}`);
  });
  it('persists next step and structured unpaid gate with transition-aware enabled time', async () => {
    const { service, calls } = harness();
    const result = await service.update(
      'case-a',
      {
        estimated_next_step: 'Forensic Analysis',
        payment_gate_enabled: true,
        payment_gate_title: 'Review Fee',
        payment_gate_amount: 100,
        payment_gate_currency: 'USD',
        payment_gate_blocks_progress: true,
        payment_gate_status: 'REQUIRED',
      },
      admin,
    );
    expect(result.estimated_next_step).toBe('Forensic Analysis');
    expect(
      (result.payment_gate as Record<string, unknown>).progress_blocked,
    ).toBe(true);
    expect(
      calls.some((sql) => sql.includes('enabled_at=CASE WHEN $8=true')),
    ).toBe(true);
  });
  it('rejects fabricated paid status', async () => {
    const { service } = harness();
    await expect(
      service.update('case-a', { payment_gate_status: 'PAID' }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('does not treat a legacy paid label as authoritative without a verified matching payment', async () => {
    const db = {
      query: jest.fn(async (sql: string) =>
        sql.includes('SELECT c.*')
          ? [baseCase]
          : sql.includes('SELECT cp.*,EXISTS')
            ? [
                {
                  status: 'paid',
                  gate_enabled: true,
                  has_authoritative_payment: false,
                },
              ]
            : [],
      ),
    };
    const result = await new CaseProgressService(db as never).get(
      'case-a',
      admin,
    );
    expect((result.payment_gate as Record<string, unknown>).status).toBe(
      'REQUIRED',
    );
  });
  it.each([
    ['required', false, true],
    ['paid', true, false],
    ['waived', false, false],
  ])(
    'enforces authoritative payment gating for %s',
    async (status, hasPayment, blocked) => {
      const db = {
        query: jest.fn().mockResolvedValue([
          {
            status,
            gate_enabled: true,
            blocks_progress: true,
            has_authoritative_payment: hasPayment,
          },
        ]),
      };
      const service = new CaseProgressService(db as never);
      if (blocked)
        await expect(service.assertProgressAllowed('case-a')).rejects.toThrow(
          /paid or waived/,
        );
      else
        await expect(
          service.assertProgressAllowed('case-a'),
        ).resolves.toBeUndefined();
    },
  );
  it('requires a verified payment on the gate invoice with the exact gate amount', async () => {
    const db = {
      query: jest.fn().mockResolvedValue([
        {
          status: 'paid',
          gate_enabled: true,
          blocks_progress: true,
          has_authoritative_payment: false,
        },
      ]),
    };
    const service = new CaseProgressService(db as never);
    await expect(service.assertProgressAllowed('case-a')).rejects.toThrow(
      /paid or waived/,
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("p.verification_status='verified'"),
      ['case-a'],
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('p.invoice_id=cp.invoice_id'),
      ['case-a'],
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('p.amount=cp.amount'),
      ['case-a'],
    );
  });
  it('returns only client-visible timeline rows for the bound case', async () => {
    const db = {
      query: jest.fn(async (sql: string) =>
        sql.includes('SELECT c.*')
          ? [baseCase]
          : sql.includes('is_client_visible=true')
            ? [{ id: 'event-a', title: 'Visible' }]
            : [],
      ),
    };
    const service = new CaseProgressService(db as never);
    const result = await service.clientWorkspace('case-a', 'timeline', client);
    expect(result).toEqual({ records: [{ id: 'event-a', title: 'Visible' }] });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('is_client_visible=true'),
      ['case-a', 'org-a'],
    );
  });
  it('denies staff sessions and unknown client modules', async () => {
    const service = new CaseProgressService({
      query: jest.fn().mockResolvedValue([baseCase]),
    } as never);
    await expect(
      service.clientWorkspace('case-a', 'timeline', admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.clientWorkspace('case-a', 'audit', client),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('does not return or time Treasury while organization Treasury features are disabled', async () => {
    const db = {
      query: jest.fn(async (sql: string) =>
        sql.includes('SELECT c.*')
          ? [baseCase]
          : sql.includes('treasury_enabled')
            ? [
                {
                  treasury_enabled: false,
                  server_time: '2026-08-25T00:00:00.000Z',
                },
              ]
            : [],
      ),
    };
    const service = new CaseProgressService(db as never);
    await expect(
      service.clientWorkspace('case-a', 'treasury', client),
    ).resolves.toEqual({
      available: false,
      enabled_at: null,
      server_time: '2026-08-25T00:00:00.000Z',
      records: [],
    });
  });
  it('maps ledger-derived balances and sanitized funding into the client response', async () => {
    const queries: string[] = [];
    const db = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return sql.includes('SELECT c.*')
          ? [baseCase]
          : sql.includes('treasury_enabled')
            ? [
                {
                  treasury_enabled: true,
                  enabled_at: '2026-08-25T00:00:00.000Z',
                  server_time: '2026-08-25T00:00:05.000Z',
                },
              ]
            : [];
      }),
    };
    const service = new CaseProgressService(db as never);
    await service.clientWorkspace('case-a', 'treasury', client);
    expect(queries.some((sql) => sql.includes('derived_balance'))).toBe(true);
    expect(queries.some((sql) => sql.includes('f.funding_type'))).toBe(true);
    expect(queries.some((sql) => sql.includes('NULL::text AS status'))).toBe(
      true,
    );
  });
});
