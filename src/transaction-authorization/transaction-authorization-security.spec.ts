import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TransactionAuthorizationService } from './transaction-authorization.service';

describe('Transaction Authorization supporting verification security', () => {
  const config = { get: jest.fn() };

  it('never lets a client self-verify a supporting document', async () => {
    const db = { query: jest.fn(), transaction: jest.fn() };
    const service = new TransactionAuthorizationService(
      db as never,
      config as never,
    );
    await expect(
      service.review(
        '11111111-1111-4111-8111-111111111111',
        { status: 'VERIFIED' },
        {
          role: 'client',
          organizationId: '22222222-2222-4222-8222-222222222222',
          actorId: '33333333-3333-4333-8333-333333333333',
          caseId: '11111111-1111-4111-8111-111111111111',
        } as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('never lets staff upload through the client endpoint', async () => {
    const db = { query: jest.fn(), transaction: jest.fn() };
    const service = new TransactionAuthorizationService(
      db as never,
      config as never,
    );
    await expect(
      service.upload('11111111-1111-4111-8111-111111111111', {}, {
        role: 'admin',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('returns not found when the case is outside the caller organization', async () => {
    const db = { query: jest.fn().mockResolvedValueOnce([]) };
    const service = new TransactionAuthorizationService(
      db as never,
      config as never,
    );
    await expect(
      service.get('11111111-1111-4111-8111-111111111111', {
        role: 'admin',
        organizationId: '22222222-2222-4222-8222-222222222222',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('c.organization_id=$2'),
      expect.arrayContaining(['22222222-2222-4222-8222-222222222222']),
    );
  });
});
