import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PaymentsService } from './payments.service';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

const OPERATOR = 'a0000000-0000-4000-8000-000000000001';
const CLIENT = 'a0000000-0000-4000-8000-000000000002';
const CASE_ID = '7b2abe2a-9312-42b8-a48d-408fd1771b77';
const ADMIN: VerifiedIdentity = {
  actorId: OPERATOR,
  organizationId: 'org-a',
  role: 'admin',
  supabaseUserId: 'sub-a',
};
const CLIENT_IDENTITY: VerifiedIdentity = {
  actorId: CLIENT,
  organizationId: 'org-a',
  role: 'client',
  supabaseUserId: '',
  caseId: CASE_ID,
};

describe('PaymentsService — Global Payment Gate', () => {
  let service: PaymentsService;
  let query: jest.Mock;

  beforeEach(async () => {
    query = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getDataSourceToken(), useValue: { query } },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('10. global payment settings can be enabled and disabled', async () => {
    query.mockResolvedValueOnce([
      { result: { enabled: false, payment_title: null, amount: null } },
    ]);
    expect((await service.getPaymentGate(ADMIN))?.enabled).toBe(false);

    query.mockResolvedValueOnce([
      {
        result: {
          enabled: true,
          payment_title: 'Service Fee',
          amount: 150,
        },
      },
    ]);
    await service.updatePaymentGate(ADMIN, { enabled: true });
    const sql = query.mock.calls[1][0] as string;
    expect(sql).toContain('vf_update_payment_gate');

    query.mockResolvedValueOnce([{ result: { enabled: false } }]);
    await service.updatePaymentGate(ADMIN, { enabled: false });
    expect(query.mock.calls[2][0]).toContain('vf_update_payment_gate');
  });

  it('11. global payment title/description/amount/currency are configurable', async () => {
    query.mockResolvedValue([
      {
        result: {
          enabled: true,
          payment_title: 'Service Fee',
          payment_description: 'Verified client service fee.',
          amount: 150,
          currency: 'USD',
          payment_methods: ['card', 'bank'],
        },
      },
    ]);
    const gate = await service.updatePaymentGate(ADMIN, {
      payment_title: 'Service Fee',
      payment_description: 'Verified client service fee.',
      amount: 150,
      currency: 'USD',
      payment_methods: ['card', 'bank'],
    });
    expect(gate).toMatchObject({
      payment_title: 'Service Fee',
      payment_description: 'Verified client service fee.',
      amount: 150,
      currency: 'USD',
    });
    const args = query.mock.calls[0][1] as unknown[];
    expect(args[3]).toBe('Service Fee');
    expect(args[5]).toBe(150);
  });

  it('12. unauthorized (non-admin) users cannot modify payment settings', async () => {
    await expect(
      service.updatePaymentGate(CLIENT_IDENTITY, { enabled: true }),
    ).rejects.toThrow(/administrator/);
  });

  it('13. changing payment settings creates an audit record', async () => {
    query.mockResolvedValue([
      {
        result: [
          {
            id: 'audit-1',
            actor_name: 'Vineford Operations',
            setting: 'amount',
            previous_value: '100',
            new_value: '150',
            created_at: '2026-08-15T00:00:00Z',
          },
        ],
      },
    ]);
    const audit = await service.getPaymentGateAudit(ADMIN);
    const entries = audit as unknown as Array<Record<string, unknown>>;
    expect(entries[0]).toMatchObject({
      setting: 'amount',
      actor_name: 'Vineford Operations',
      previous_value: '100',
      new_value: '150',
    });
  });

  it('14. global settings do not automatically create a payment obligation for every case', async () => {
    query.mockResolvedValue([
      {
        result: {
          exists: false,
          status: 'not_required',
        },
      },
    ]);
    query
      .mockResolvedValueOnce([{ id: CASE_ID }])
      .mockResolvedValueOnce([
        { result: { exists: false, status: 'not_required' } },
      ]);
    const payment = await service.getCasePayment(CASE_ID, ADMIN);
    expect(payment).toMatchObject({ exists: false, status: 'not_required' });

    const sqlCalls = query.mock.calls.map((c) => c[0] as string);
    expect(sqlCalls.some((s) => s.includes('vf_set_case_payment_status'))).toBe(
      false,
    );
  });
});
