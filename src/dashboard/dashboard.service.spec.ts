import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DashboardService } from './dashboard.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

const adminActor = {
  id: 'a0000000-0000-4000-8000-000000000001',
  role: 'admin',
  organization_id: 'org-1',
  name: 'Admin',
  email: 'admin@vineford.com',
};

describe('DashboardService', () => {
  let service: DashboardService;
  let mockDataSource: { query: jest.Mock };

  beforeEach(async () => {
    mockDataSource = { query: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();
    service = module.get<DashboardService>(DashboardService);
  });

  it('returns the summary from the vf_dashboard_summary function', async () => {
    mockDataSource.query.mockResolvedValueOnce([{ result: { open_cases: 1 } }]);
    const summary = await service.summary(adminActor);
    expect(summary).toEqual({ open_cases: 1 });
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_dashboard_summary($1)'),
      ['org-1'],
    );
  });

  it('returns phase distribution', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      { result: [{ phase: 'next_client_action', count: 1 }] },
    ]);
    const dist = await service.phaseDistribution(adminActor);
    expect(dist).toEqual([{ phase: 'next_client_action', count: 1 }]);
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_dashboard_phase_distribution($1)'),
      ['org-1'],
    );
  });

  it('returns time-in-phase averages', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      { result: [{ phase: 'documents_verified', avg_days: 2.5 }] },
    ]);
    const tip = await service.timeInPhase(adminActor);
    expect(tip).toEqual([{ phase: 'documents_verified', avg_days: 2.5 }]);
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_dashboard_time_in_phase($1)'),
      ['org-1'],
    );
  });

  it('returns payment aging buckets', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      { result: [{ bucket: 'overdue_31_60', count: 2, amount: 1000 }] },
    ]);
    const aging = await service.paymentAging(adminActor);
    expect(aging).toEqual([
      { bucket: 'overdue_31_60', count: 2, amount: 1000 },
    ]);
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_dashboard_payment_aging($1)'),
      ['org-1'],
    );
  });

  it('lists organization cases with client details', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      {
        id: 'case-1',
        case_number: 'VF-2026-8282',
        status: 'open',
        legal_hold: false,
        client_name: 'Gayl M. Chenoweth',
      },
    ]);
    const cases = await service.listCases(adminActor);
    expect(cases[0].case_number).toBe('VF-2026-8282');
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM public.cases c'),
      ['org-1'],
    );
  });

  it('searches cases, clients, documents, and invoices within the actor organization', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      { type: 'case', id: 'case-1', label: 'VF-TEST-1' },
    ]);
    const result = await service.search(adminActor, 'Gayl');
    expect(result.items).toHaveLength(1);
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('c.organization_id=$1'),
      ['org-1', '%Gayl%'],
    );
  });

  it('does not query broad search terms shorter than two characters', async () => {
    await expect(service.search(adminActor, 'V')).resolves.toEqual({
      items: [],
    });
    expect(mockDataSource.query).not.toHaveBeenCalled();
  });

  it('loads only organization-scoped operational workspaces', async () => {
    mockDataSource.query.mockResolvedValueOnce([{ id: 'client-1' }]);
    const result = await service.workspace(adminActor, 'clients');
    expect(result.records).toEqual([{ id: 'client-1' }]);
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('cl.organization_id=$1'),
      ['org-1'],
    );
    await expect(
      service.workspace(adminActor, 'secrets'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('audits an isolated evidence review without changing immutable metadata', async () => {
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes('SELECT e.*')
          ? [
              {
                id: 'e-1',
                case_id: 'case-fixture',
                review_status: 'pending',
                file_url: 'immutable',
              },
            ]
          : sql.includes('UPDATE public.evidence')
            ? [{ id: 'e-1', review_status: 'approved', file_url: 'immutable' }]
            : [],
      ),
    };
    const service = new DashboardService({
      transaction: jest.fn(async (fn: (m: typeof manager) => unknown) =>
        fn(manager),
      ),
    } as never);
    const result = await service.review(adminActor, 'evidence', 'e-1', {
      action: 'approve',
    });
    expect(result.review_status).toBe('approved');
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.audit_logs'),
      expect.arrayContaining([
        'org-1',
        adminActor.id,
        'evidence.review.approved',
      ]),
    );
    expect(
      manager.query.mock.calls.find(([sql]) =>
        String(sql).includes('UPDATE public.evidence'),
      )?.[0],
    ).not.toContain('file_url');
  });
  it('rejects payment verification without authoritative proof', async () => {
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes('SELECT p.*')
          ? [
              {
                id: 'p-1',
                case_id: 'case-fixture',
                verification_status: 'pending',
                reference_number: 'PAY-FIXTURE',
                amount: 10,
                invoice_amount: 10,
              },
            ]
          : [],
      ),
    };
    const service = new DashboardService({
      transaction: jest.fn(async (fn: (m: typeof manager) => unknown) =>
        fn(manager),
      ),
    } as never);
    await expect(
      service.review(adminActor, 'payment', 'p-1', { action: 'verify' }),
    ).rejects.toThrow('authoritative supporting proof document is required');
  });
  it('rejects a cross-case or cross-organization proof document', async () => {
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes('SELECT p.*')
          ? [
              {
                id: 'p-2',
                case_id: 'case-fixture',
                verification_status: 'pending',
                reference_number: 'PAY-FIXTURE',
                amount: 10,
                invoice_amount: 10,
              },
            ]
          : [],
      ),
    };
    const service = new DashboardService({
      transaction: jest.fn(async (fn: (m: typeof manager) => unknown) =>
        fn(manager),
      ),
    } as never);
    await expect(
      service.review(adminActor, 'payment', 'p-2', {
        action: 'verify',
        proof_document_id: '00000000-0000-4000-8000-000000000002',
      }),
    ).rejects.toThrow('does not belong to this case and organization');
  });
  it('verifies an authoritative payment with a scoped proof document and audits the link', async () => {
    const payment = {
      id: 'p-3',
      case_id: 'case-fixture',
      verification_status: 'pending',
      reference_number: 'PAY-FIXTURE-3',
      amount: 10,
      invoice_amount: 10,
      invoice_number: 'INV-3',
    };
    const proof = '00000000-0000-4000-8000-000000000003';
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes('SELECT p.*')
          ? [payment]
          : sql.includes('SELECT d.id')
            ? [{ id: proof }]
            : sql.includes('SELECT id FROM public.payments')
              ? []
              : sql.includes('UPDATE public.payments')
                ? [
                    {
                      ...payment,
                      verification_status: 'verified',
                      proof_document_id: proof,
                    },
                  ]
                : [],
      ),
    };
    const result = await new DashboardService({
      transaction: jest.fn(async (fn: (m: typeof manager) => unknown) =>
        fn(manager),
      ),
    } as never).review(adminActor, 'payment', 'p-3', {
      action: 'verify',
      proof_document_id: proof,
    });
    expect(result.verification_status).toBe('verified');
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.audit_logs'),
      expect.arrayContaining([
        'org-1',
        adminActor.id,
        'payment.review.verified',
      ]),
    );
  });
  it('enforces transfer dual control and terminal-state safety', async () => {
    const own = {
      query: jest.fn(async () => [
        {
          id: 't-1',
          case_id: 'case-fixture',
          status: 'under_review',
          prepared_by: adminActor.id,
        },
      ]),
    };
    const service = new DashboardService({
      transaction: jest.fn(async (fn: (m: typeof own) => unknown) => fn(own)),
    } as never);
    await expect(
      service.review(adminActor, 'transfer', 't-1', { action: 'approve' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const terminal = {
      query: jest.fn(async () => [
        {
          id: 't-2',
          case_id: 'case-fixture',
          status: 'executed',
          prepared_by: 'other',
        },
      ]),
    };
    await expect(
      new DashboardService({
        transaction: jest.fn(async (fn: (m: typeof terminal) => unknown) =>
          fn(terminal),
        ),
      } as never).review(adminActor, 'transfer', 't-2', {
        action: 'reject',
        note: 'invalid',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('blocks transfer approval with actionable missing-destination errors', async () => {
    const manager = {
      query: jest.fn(async (_sql: string, _params?: unknown[]) => [
        {
          id: 't-3',
          case_id: 'case-fixture',
          status: 'under_review',
          prepared_by: 'other',
          requester_active: true,
          amount: 10,
          currency: 'USD',
        },
      ]),
    };
    const service = new DashboardService({
      transaction: jest.fn(async (fn: (m: typeof manager) => unknown) =>
        fn(manager),
      ),
    } as never);
    await expect(
      service.review(adminActor, 'transfer', 't-3', {
        action: 'approve',
        case_id: 'case-fixture',
      }),
    ).rejects.toThrow(
      /receiving institution name is required.*receiving account number.*SWIFT\/BIC or routing identifier/s,
    );
    expect(
      manager.query.mock.calls.some(([sql]) =>
        String(sql).includes('UPDATE public.case_transfers'),
      ),
    ).toBe(false);
  });
  it('approves only a valid organization-scoped under-review transfer', async () => {
    const fixture = {
      id: 't-4',
      case_id: 'case-fixture',
      status: 'under_review',
      prepared_by: 'other',
      requester_active: true,
      receiving_institution_name: 'Fixture Bank',
      receiving_institution_country: 'US',
      receiving_account_number: 'ACCT-12345',
      beneficiary_name: 'Fixture Client',
      receiving_institution_swift: 'ABCDEFGH',
      receiving_institution_routing_number: null,
      amount: 100,
      currency: 'USD',
      transfer_reference: 'TR-FIXTURE',
    };
    const manager = {
      query: jest.fn(async (sql: string, _params?: unknown[]) =>
        sql.includes('SELECT t.*')
          ? [fixture]
          : sql.includes('UPDATE public.case_transfers')
            ? [{ ...fixture, status: 'verified' }]
            : [],
      ),
    };
    const result = await new DashboardService({
      transaction: jest.fn(async (fn: (m: typeof manager) => unknown) =>
        fn(manager),
      ),
    } as never).review(adminActor, 'transfer', 't-4', {
      action: 'approve',
      case_id: 'case-fixture',
    });
    expect(result.status).toBe('verified');
    expect(
      manager.query.mock.calls.find(([sql]) =>
        String(sql).includes('UPDATE public.case_transfers'),
      )?.[1],
    ).toEqual(expect.arrayContaining(['verified', true, adminActor.id]));
  });
  it('rejects cross-case substitution before transfer approval', async () => {
    const manager = {
      query: jest.fn(async () => [
        {
          id: 't-5',
          case_id: 'case-fixture',
          status: 'under_review',
          prepared_by: 'other',
        },
      ]),
    };
    await expect(
      new DashboardService({
        transaction: jest.fn(async (fn: (m: typeof manager) => unknown) =>
          fn(manager),
        ),
      } as never).review(adminActor, 'transfer', 't-5', {
        action: 'approve',
        case_id: 'other-case',
      }),
    ).rejects.toThrow('review case does not match the transfer case');
  });
  it('makes duplicate review approval idempotent without duplicate audit', async () => {
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes('SELECT e.*')
          ? [{ id: 'e-1', case_id: 'case-fixture', review_status: 'approved' }]
          : [],
      ),
    };
    const result = await new DashboardService({
      transaction: jest.fn(async (fn: (m: typeof manager) => unknown) =>
        fn(manager),
      ),
    } as never).review(adminActor, 'evidence', 'e-1', { action: 'approve' });
    expect(result.review_status).toBe('approved');
    expect(
      manager.query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO public.audit_logs'),
      ),
    ).toBe(false);
  });

  it('loads a complete organization-scoped case detail by case reference', async () => {
    mockDataSource.query.mockImplementation(
      (sql: string, params: unknown[]) => {
        if (
          sql.includes('FROM public.cases c') &&
          sql.includes('c.case_number=$1')
        ) {
          return Promise.resolve([
            { id: 'case-1', case_number: 'VF-2026-8282' },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    const detail = await service.caseDetail(adminActor, 'VF-2026-8282');

    expect(detail.case).toMatchObject({
      id: 'case-1',
      case_number: 'VF-2026-8282',
    });
    expect(detail).toHaveProperty('documentRequests');
    expect(detail).toHaveProperty('clientActions');
    expect(detail).toHaveProperty('treasuryAccounts');
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('client_case_access a JOIN public.cases c'),
      ['case-1', 'org-1'],
    );
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining(
        '(c.id::text=$1 OR c.case_number=$1) AND c.organization_id=$2',
      ),
      ['VF-2026-8282', 'org-1'],
    );
  });

  it('loads only the requested organization-scoped case module', async () => {
    mockDataSource.query.mockImplementation(
      (sql: string, params: unknown[]) => {
        if (
          sql.includes('FROM public.cases c') &&
          sql.includes('upper(c.case_number)')
        )
          return Promise.resolve([{ id: 'case-1', case_number: 'VF-TEST-1' }]);
        if (sql.includes('FROM public.documents d'))
          return Promise.resolve([{ id: 'document-1', title: 'Fixture' }]);
        return Promise.resolve([]);
      },
    );
    const result = await service.caseModule(
      adminActor,
      'VF-TEST-1',
      'documents',
    );
    expect(result.records).toEqual([{ id: 'document-1', title: 'Fixture' }]);
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('d.organization_id=$2'),
      ['case-1', 'org-1'],
    );
  });

  it('rejects unknown modules and cases outside the organization', async () => {
    mockDataSource.query.mockResolvedValueOnce([{ id: 'case-1' }]);
    await expect(
      service.caseModule(adminActor, 'case-1', 'secrets'),
    ).rejects.toBeInstanceOf(BadRequestException);
    mockDataSource.query.mockResolvedValueOnce([]);
    await expect(
      service.caseModule(adminActor, 'missing', 'documents'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates and audits an isolated organization-scoped timeline fixture', async () => {
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes('SELECT id,case_number')
          ? [
              {
                id: 'fixture-case',
                organization_id: 'org-1',
                client_id: 'fixture-client',
              },
            ]
          : sql.includes('INSERT INTO public.timeline')
            ? [{ id: 'fixture-event', title: 'Fixture event' }]
            : [],
      ),
    };
    const db = {
      transaction: jest.fn(async (fn: (value: typeof manager) => unknown) =>
        fn(manager),
      ),
    };
    const result = await new DashboardService(
      db as never,
    ).createCaseModuleRecord(adminActor, 'VF-FIXTURE', 'timeline', {
      title: 'Fixture event',
      is_client_visible: true,
    });
    expect(result.id).toBe('fixture-event');
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.audit_logs'),
      expect.arrayContaining(['org-1', adminActor.id, 'timeline.created']),
    );
  });

  it('creates admin messages through the existing secure messaging function', async () => {
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes('SELECT id,case_number')
          ? [
              {
                id: 'fixture-case',
                organization_id: 'org-1',
                client_id: 'fixture-client',
              },
            ]
          : sql.includes('vf_send_case_message')
            ? [
                {
                  result: {
                    id: 'fixture-message',
                    case_id: 'fixture-case',
                    content: 'Hello client',
                  },
                },
              ]
            : [],
      ),
    };
    const db = {
      transaction: jest.fn(async (fn: (value: typeof manager) => unknown) =>
        fn(manager),
      ),
    };
    const result = await new DashboardService(
      db as never,
    ).createCaseModuleRecord(adminActor, 'VF-FIXTURE', 'messages', {
      content: '  Hello client  ',
    });
    expect(result).toMatchObject({
      id: 'fixture-message',
      content: 'Hello client',
    });
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_send_case_message'),
      ['fixture-case', adminActor.id, 'Hello client'],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.case_notifications'),
      ['fixture-case', 'org-1', 'Hello client'],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.audit_logs'),
      expect.arrayContaining(['org-1', adminActor.id, 'message.created']),
    );
  });

  it('rejects empty admin messages before any insert', async () => {
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes('SELECT id,case_number')
          ? [
              {
                id: 'fixture-case',
                organization_id: 'org-1',
                client_id: 'fixture-client',
              },
            ]
          : [],
      ),
    };
    const db = {
      transaction: jest.fn(async (fn: (value: typeof manager) => unknown) =>
        fn(manager),
      ),
    };
    await expect(
      new DashboardService(db as never).createCaseModuleRecord(
        adminActor,
        'VF-FIXTURE',
        'messages',
        { content: '   ' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.query).not.toHaveBeenCalledWith(
      expect.stringContaining('vf_send_case_message'),
      expect.anything(),
    );
  });

  it('rejects paid invoice creation and cross-organization mutation targets', async () => {
    const scoped = {
      query: jest.fn(async (sql: string) =>
        sql.includes('SELECT id,case_number')
          ? [
              {
                id: 'fixture-case',
                organization_id: 'org-1',
                client_id: 'fixture-client',
              },
            ]
          : [],
      ),
    };
    const db = {
      transaction: jest.fn(async (fn: (value: typeof scoped) => unknown) =>
        fn(scoped),
      ),
    };
    await expect(
      new DashboardService(db as never).createCaseModuleRecord(
        adminActor,
        'VF-FIXTURE',
        'invoices',
        { amount: 10, status: 'paid' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const missing = { query: jest.fn().mockResolvedValue([]) };
    await expect(
      new DashboardService({
        transaction: jest.fn(async (fn: (value: typeof missing) => unknown) =>
          fn(missing),
        ),
      } as never).createCaseModuleRecord(adminActor, 'OTHER-ORG', 'timeline', {
        title: 'No',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
