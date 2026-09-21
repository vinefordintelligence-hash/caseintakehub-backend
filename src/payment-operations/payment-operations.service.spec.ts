import { ForbiddenException } from '@nestjs/common';
import { PaymentOperationsService } from './payment-operations.service';

const org = '11111111-1111-4111-8111-111111111111';
const invoiceId = '33333333-3333-4333-8333-333333333333';
const paymentId = '44444444-4444-4444-8444-444444444444';
const identity = {
  actorId: '55555555-5555-4555-8555-555555555555',
  organizationId: org,
  role: 'admin',
  supabaseUserId: 'synthetic-admin',
};

describe('PaymentOperationsService', () => {
  it('requires administrator authority and never accepts a client assertion', async () => {
    const service = new PaymentOperationsService({} as never, {} as never);
    await expect(
      service.createRequirement({}, { ...identity, role: 'client' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('defines only legal lifecycle transitions', async () => {
    const { canTransition } = await import('./payment-operations');
    expect(canTransition('DRAFT', 'AUTHORIZED')).toBe(true);
    expect(canTransition('DRAFT', 'VERIFIED')).toBe(false);
    expect(canTransition('VERIFIED', 'CANCELLED')).toBe(false);
  });

  it('does not allow an admin assertion to represent authoritative payment', async () => {
    const workflow = { publish: jest.fn() };
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'operation',
            organization_id: org,
            state: 'PENDING',
            invoice_id: invoiceId,
            currency: 'USD',
            generation: 1,
          },
        ])
        .mockResolvedValueOnce([]),
    };
    const data = {
      transaction: (fn: (m: typeof manager) => unknown) => fn(manager),
    };
    const bound = new PaymentOperationsService(
      data as never,
      workflow as never,
    );
    await expect(
      bound.recordAuthoritativePayment('operation', paymentId, identity),
    ).rejects.toBeInstanceOf(Error);
    expect(workflow.publish).not.toHaveBeenCalled();
  });
});
