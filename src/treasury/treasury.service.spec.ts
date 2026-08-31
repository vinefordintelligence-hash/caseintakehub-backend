import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TreasuryService } from './treasury.service';

const admin = {
  actorId: 'admin-a',
  organizationId: 'org-a',
  role: 'admin',
  supabaseUserId: 'sup-a',
};
const superAdmin = { ...admin, role: 'super_admin' };
const client = {
  actorId: 'client-a',
  organizationId: 'org-a',
  role: 'client',
  supabaseUserId: '',
  caseId: 'case-a',
};
const assignment = {
  id: 'address-a',
  organization_id: 'org-a',
  treasury_account_id: 'account-a',
  case_id: 'case-a',
  app_user_id: 'client-a',
  network: 'algorand_testnet',
  asset: 'ALGO',
  deposit_address: 'A'.repeat(58),
  currency: 'ALGO',
};

describe('TreasuryService real-chain integrity', () => {
  const algorand = { publicKey: jest.fn(), lookupTransaction: jest.fn() };
  const provider = { assign: jest.fn() };
  afterEach(() => jest.clearAllMocks());
  it('rejects a forged transaction whose independently verified destination differs', async () => {
    const db = { query: jest.fn().mockResolvedValueOnce([assignment]) };
    algorand.lookupTransaction.mockResolvedValue({
      transactionHash: 'T'.repeat(52),
      confirmedRound: 1,
      sender: 'S',
      receiver: 'WRONG',
      amount: 1_000_000,
      assetId: null,
      rawPayload: {},
    });
    const service = new TreasuryService(
      db as never,
      algorand as never,
      provider as never,
      { get: jest.fn() } as never,
    );
    await expect(
      service.verifyDeposit(
        'address-a',
        { transaction_hash: 'T'.repeat(52) },
        client,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
  it('credits the immutable ledger exactly once and makes replay idempotent', async () => {
    let inserted = false,
      credited = false;
    const managerQuery = jest.fn(async (sql: string) => {
      if (
        sql.includes('FOR UPDATE') &&
        !sql.includes('treasury_chain_deposits')
      )
        return [{ id: 'address-a' }];
      if (sql.includes('INSERT INTO public.treasury_chain_deposits')) {
        if (inserted) return [];
        inserted = true;
        return [
          {
            id: 'deposit-a',
            organization_id: 'org-a',
            deposit_address_id: 'address-a',
            status: 'verified',
          },
        ];
      }
      if (sql.includes('SELECT * FROM public.treasury_chain_deposits'))
        return [
          {
            id: 'deposit-a',
            organization_id: 'org-a',
            deposit_address_id: 'address-a',
            status: credited ? 'credited' : 'verified',
            ledger_entry_id: credited ? 'ledger-a' : null,
          },
        ];
      if (sql.includes('INSERT INTO public.treasury_ledger_entries'))
        return [{ id: 'ledger-a' }];
      if (sql.includes('UPDATE public.treasury_chain_deposits')) {
        credited = true;
        return [
          { id: 'deposit-a', status: 'credited', ledger_entry_id: 'ledger-a' },
        ];
      }
      return [];
    });
    const db = {
      query: jest.fn().mockResolvedValue([assignment]),
      transaction: jest.fn(async (fn: any) => fn({ query: managerQuery })),
    };
    algorand.lookupTransaction.mockResolvedValue({
      transactionHash: 'T'.repeat(52),
      confirmedRound: 10,
      sender: 'S',
      receiver: assignment.deposit_address,
      amount: 2_000_000,
      assetId: null,
      rawPayload: {},
    });
    const service = new TreasuryService(
      db as never,
      algorand as never,
      provider as never,
      { get: jest.fn() } as never,
    );
    await service.verifyDeposit(
      'address-a',
      { transaction_hash: 'T'.repeat(52) },
      client,
    );
    await service.verifyDeposit(
      'address-a',
      { transaction_hash: 'T'.repeat(52) },
      client,
    );
    expect(
      managerQuery.mock.calls.filter((c) =>
        String(c[0]).includes('INSERT INTO public.treasury_ledger_entries'),
      ),
    ).toHaveLength(1);
  });
  it('does not permit a requester to approve their own withdrawal', async () => {
    const manager = {
      query: jest.fn().mockResolvedValueOnce([
        {
          id: 'w',
          organization_id: 'org-a',
          requested_by: 'admin-a',
          status: 'pending_approval',
        },
      ]),
    };
    const db = { transaction: jest.fn(async (fn: any) => fn(manager)) };
    const service = new TreasuryService(
      db as never,
      algorand as never,
      provider as never,
      { get: jest.fn() } as never,
    );
    await expect(service.approveWithdrawal('w', admin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('rechecks confirmed available balance while reserving under account lock', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'w',
            organization_id: 'org-a',
            requested_by: 'other-admin',
            status: 'pending_approval',
            treasury_account_id: 'account-a',
            amount: '5',
          },
        ])
        .mockResolvedValueOnce([{ id: 'account-a' }])
        .mockResolvedValueOnce([{ balance: '4' }])
        .mockResolvedValueOnce([{ reserved: '0' }]),
    };
    const service = new TreasuryService(
      { transaction: jest.fn(async (fn: any) => fn(manager)) } as never,
      algorand as never,
      provider as never,
      { get: jest.fn() } as never,
    );
    await expect(service.approveWithdrawal('w', admin)).rejects.toThrow(
      'insufficient confirmed available balance',
    );
    expect(
      manager.query.mock.calls.some((c) =>
        String(c[0]).includes("status='approved'"),
      ),
    ).toBe(false);
  });
  it('never executes without an isolated Testnet custody signer', async () => {
    const service = new TreasuryService(
      {} as never,
      algorand as never,
      provider as never,
      { get: jest.fn() } as never,
    );
    await expect(service.executeWithdrawal()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it('permits only a super administrator to assign an externally custodied public address', async () => {
    const account = {
      id: 'account-a',
      organization_id: 'org-a',
      case_id: null,
      status: 'active',
    };
    const db = { query: jest.fn().mockResolvedValueOnce([account]) };
    const service = new TreasuryService(
      db as never,
      algorand as never,
      provider as never,
      { get: jest.fn() } as never,
    );
    await expect(
      service.assignAddress(
        {
          treasury_account_id: 'account-a',
          network: 'algorand_testnet',
          asset: 'ALGO',
          deposit_address: 'A'.repeat(58),
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const superDb = {
      query: jest
        .fn()
        .mockResolvedValueOnce([account])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'address-a' }])
        .mockResolvedValueOnce([]),
    };
    provider.assign.mockResolvedValue({
      address: 'A'.repeat(58),
      addressType: 'non_custodial',
      provider: 'administrator_supplied_public',
      reference: 'ref',
      metadata: {},
    });
    const superService = new TreasuryService(
      superDb as never,
      algorand as never,
      provider as never,
      { get: jest.fn() } as never,
    );
    await expect(
      superService.assignAddress(
        {
          treasury_account_id: 'account-a',
          network: 'algorand_testnet',
          asset: 'ALGO',
          deposit_address: 'A'.repeat(58),
        },
        superAdmin,
      ),
    ).resolves.toMatchObject({ id: 'address-a' });
  });
  it('rejects reuse of a public Testnet address before calling the provider', async () => {
    const account = {
      id: 'account-a',
      organization_id: 'org-a',
      case_id: null,
      status: 'active',
    };
    const db = {
      query: jest
        .fn()
        .mockResolvedValueOnce([account])
        .mockResolvedValueOnce([{ id: 'existing' }]),
    };
    const service = new TreasuryService(
      db as never,
      algorand as never,
      provider as never,
      { get: jest.fn() } as never,
    );
    await expect(
      service.assignAddress(
        {
          treasury_account_id: 'account-a',
          network: 'algorand_testnet',
          asset: 'ALGO',
          deposit_address: 'A'.repeat(58),
        },
        superAdmin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(provider.assign).not.toHaveBeenCalled();
  });
  it('creates pending funding without crediting the ledger', async () => {
    const queries: string[] = [];
    const manager = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT a.id'))
          return [
            {
              id: 'account-a',
              currency: 'USD',
              case_id: 'case-a',
              client_id: 'client-a',
            },
          ];
        if (sql.includes('SELECT id FROM public.documents'))
          return [{ id: 'document-a' }];
        if (sql.includes('INSERT INTO public.treasury_funding_allocations'))
          return [{ id: 'funding-a', status: 'pending', notes: null }];
        return [];
      }),
    };
    const service = new TreasuryService(
      { transaction: jest.fn(async (fn: any) => fn(manager)) } as never,
      algorand as never,
      provider as never,
      { get: jest.fn() } as never,
    );
    await expect(
      service.createFunding(
        {
          treasury_account_id: 'account-a',
          case_id: 'case-a',
          client_id: 'client-a',
          amount: 25,
          currency: 'USD',
          funding_reference: 'F-1',
          funding_type: 'client_deposit',
          external_reference: 'BANK-1',
          supporting_document_id: 'document-a',
        },
        admin,
      ),
    ).resolves.toMatchObject({ status: 'pending' });
    expect(
      queries.some((sql) =>
        sql.includes('INSERT INTO public.treasury_ledger_entries'),
      ),
    ).toBe(false);
  });
  it('credits the immutable ledger only during authorized verification', async () => {
    const queries: string[] = [];
    const manager = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT * FROM public.treasury_funding_allocations'))
          return [
            {
              id: 'funding-a',
              organization_id: 'org-a',
              treasury_account_id: 'account-a',
              case_id: 'case-a',
              amount: '25',
              currency: 'USD',
              funding_type: 'client_deposit',
              funding_effect: 'credit',
              external_reference: 'BANK-1',
              supporting_document_id: 'document-a',
              status: 'under_review',
            },
          ];
        if (sql.includes('SELECT id,status,currency'))
          return [
            {
              id: 'account-a',
              status: 'active',
              currency: 'USD',
              case_id: 'case-a',
            },
          ];
        if (sql.includes('UPDATE public.treasury_funding_allocations'))
          return [{ id: 'funding-a', status: 'verified' }];
        return [];
      }),
    };
    const service = new TreasuryService(
      { transaction: jest.fn(async (fn: any) => fn(manager)) } as never,
      algorand as never,
      provider as never,
      { get: jest.fn() } as never,
    );
    await expect(
      service.reviewFunding('funding-a', { status: 'verified' }, admin),
    ).resolves.toMatchObject({ status: 'verified' });
    expect(
      queries.filter((sql) =>
        sql.includes('INSERT INTO public.treasury_ledger_entries'),
      ),
    ).toHaveLength(1);
  });
  it('blocks withdrawal progression when authoritative client KYC is not verified', async () => {
    const account = {
      id: 'account-a',
      organization_id: 'org-a',
      case_id: 'case-a',
      status: 'active',
    };
    const queries: string[] = [];
    const manager = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('treasury_ledger_entries')) return [{ balance: '10' }];
        if (
          sql.includes('treasury_chain_withdrawals') &&
          sql.includes('COALESCE')
        )
          return [{ reserved: '0' }];
        if (sql.includes('FROM public.cases'))
          return [{ id: 'case-a', client_id: 'client-a' }];
        if (sql.includes('FROM public.client_kyc')) return [];
        if (sql.includes('transfer_document_requirements'))
          return [{ total: 0, verified: 0 }];
        if (sql.includes('case_transfers')) return [{ exists: 1 }];
        if (sql.includes('INSERT INTO public.treasury_chain_withdrawals'))
          return [{ id: 'withdrawal-a', status: 'verification_required' }];
        return [];
      }),
    };
    const db = {
      query: jest.fn().mockResolvedValue([account]),
      transaction: jest.fn(async (fn: any) => fn(manager)),
    };
    algorand.publicKey.mockReturnValue(Buffer.alloc(32));
    const service = new TreasuryService(
      db as never,
      algorand as never,
      provider as never,
      { get: jest.fn() } as never,
    );
    await expect(
      service.requestWithdrawal(
        {
          treasury_account_id: 'account-a',
          network: 'algorand_testnet',
          asset: 'ALGO',
          destination_address: 'A'.repeat(58),
          amount: 1,
          reason: 'test',
          reference: 'W-1',
        },
        admin,
      ),
    ).resolves.toMatchObject({ status: 'verification_required' });
    const insert = manager.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO public.treasury_chain_withdrawals'),
    )!;
    expect((insert as any[])[1][11]).toContain('kyc_verification_required');
  });
  it('keeps transaction-document and transfer authorization separate from verified KYC', async () => {
    const account = {
      id: 'account-a',
      organization_id: 'org-a',
      case_id: 'case-a',
      status: 'active',
    };
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('treasury_ledger_entries')) return [{ balance: '10' }];
        if (
          sql.includes('treasury_chain_withdrawals') &&
          sql.includes('COALESCE')
        )
          return [{ reserved: '0' }];
        if (sql.includes('FROM public.cases'))
          return [{ id: 'case-a', client_id: 'client-a' }];
        if (sql.includes('FROM public.client_kyc'))
          return [{ status: 'verified', expires_at: null }];
        if (sql.includes('transfer_document_requirements'))
          return [{ total: 1, verified: 0 }];
        if (sql.includes('case_transfers')) return [];
        if (sql.includes('INSERT INTO public.treasury_chain_withdrawals'))
          return [{ id: 'withdrawal-b', status: 'verification_required' }];
        return [];
      }),
    };
    const db = {
      query: jest.fn().mockResolvedValue([account]),
      transaction: jest.fn(async (fn: any) => fn(manager)),
    };
    algorand.publicKey.mockReturnValue(Buffer.alloc(32));
    const service = new TreasuryService(
      db as never,
      algorand as never,
      provider as never,
      { get: jest.fn() } as never,
    );
    await service.requestWithdrawal(
      {
        treasury_account_id: 'account-a',
        network: 'algorand_testnet',
        asset: 'ALGO',
        destination_address: 'A'.repeat(58),
        amount: 1,
        reason: 'test',
        reference: 'W-2',
      },
      admin,
    );
    const insert = manager.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO public.treasury_chain_withdrawals'),
    )!;
    expect((insert as any[])[1][11]).not.toContain('kyc_verification_required');
    expect((insert as any[])[1][11]).toContain(
      'document_verification_required',
    );
    expect((insert as any[])[1][11]).toContain(
      'transfer_authorization_required',
    );
  });
});
