import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { FundingService } from './funding.service';
import { AlgorandService } from './algorand.service';
import { FeaturePolicyService } from './feature-policy.service';

const admin: VerifiedIdentity = {
  actorId: 'actor-1',
  organizationId: 'org-1',
  role: 'admin',
  supabaseUserId: 'supabase-1',
};
const client: VerifiedIdentity = {
  actorId: 'client-1',
  organizationId: 'org-1',
  role: 'client',
  supabaseUserId: 'supabase-2',
  caseId: 'case-1',
};

describe('FundingService authorization and integrity', () => {
  let service: FundingService;
  let db: { query: jest.Mock; transaction: jest.Mock };
  let algorand: {
    publicKey: jest.Mock;
    verifyOwnership: jest.Mock;
    prepareOwnershipTransaction: jest.Mock;
    verifySignedOwnershipTransaction: jest.Mock;
    lookupTransaction: jest.Mock;
    assertEscrowMethod: jest.Mock;
    contractManifest: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      query: jest.fn(),
      transaction: jest.fn(async (callback) => callback({ query: db.query })),
    };
    algorand = {
      publicKey: jest.fn(),
      verifyOwnership: jest.fn(),
      prepareOwnershipTransaction: jest.fn().mockResolvedValue('unsigned'),
      verifySignedOwnershipTransaction: jest.fn(),
      lookupTransaction: jest.fn(),
      assertEscrowMethod: jest.fn(),
      contractManifest: jest.fn(),
    };
    const module = await Test.createTestingModule({
      providers: [
        FundingService,
        {
          provide: getDataSourceToken(),
          useValue: db,
        },
        { provide: AlgorandService, useValue: algorand },
        {
          provide: FeaturePolicyService,
          useValue: { state: jest.fn(), require: jest.fn(), update: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(FundingService);
  });

  it('rejects client program creation before querying the database', async () => {
    await expect(service.createProgram({}, client)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.query).not.toHaveBeenCalled();
  });

  it('enforces organization and recipient/case scope for client program lookup', async () => {
    db.query.mockResolvedValueOnce([]);
    await expect(service.program('program-1', client)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.query.mock.calls[0][0]).toContain('p.organization_id=$2');
    expect(db.query.mock.calls[0][0]).toContain('funding_recipients');
    expect(db.query.mock.calls[0][1]).toEqual([
      'program-1',
      'org-1',
      'case-1',
      'client-1',
    ]);
  });

  it('rejects an application currency mismatch', async () => {
    db.query.mockResolvedValueOnce([
      {
        id: 'program-1',
        currency: 'USD',
        application_mode: 'open',
        status: 'active',
      },
    ]);
    await expect(
      service.apply(
        'program-1',
        { currency: 'EUR', requested_amount: 1, statement: 'Need' },
        client,
      ),
    ).rejects.toThrow('application currency does not match program');
  });

  it('rejects weighted voting because no weighting model is enabled', async () => {
    await expect(
      service.vote('review-1', { decision: 'approve', weight: 2 }, admin),
    ).rejects.toThrow('weighted voting is not enabled');
  });

  it('maps duplicate reviewer votes to a conflict', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { code: '23505' });
    db.transaction.mockRejectedValueOnce(duplicate);
    await expect(
      service.vote('review-1', { decision: 'approve' }, admin),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects malformed wallet data without recording ownership', async () => {
    algorand.publicKey.mockImplementationOnce(() => {
      throw new BadRequestException('invalid Algorand address');
    });
    await expect(
      service.walletChallenge(
        { network: 'algorand_testnet', address: 'not-an-address' },
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('creates an expiring identity-bound wallet challenge', async () => {
    db.query.mockResolvedValueOnce([
      { id: 'link-1', verification_challenge: 'challenge' },
    ]);
    await expect(
      service.walletChallenge(
        { network: 'algorand_testnet', address: 'A'.repeat(58) },
        admin,
      ),
    ).resolves.toMatchObject({ id: 'link-1' });
    const params = db.query.mock.calls[0][1];
    expect(params[0]).toBe('org-1');
    expect(params[1]).toBe('actor-1');
    expect(params[3]).toContain('"organization_id":"org-1"');
    expect(params[3]).toContain('"actor_id":"actor-1"');
  });

  it('verifies and consumes a valid wallet challenge atomically', async () => {
    algorand.verifyOwnership.mockReturnValueOnce(true);
    db.query
      .mockResolvedValueOnce([
        {
          id: 'link-1',
          address: 'ADDR',
          verification_challenge: 'signed',
          challenge_expires_at: new Date(Date.now() + 60_000),
          challenge_consumed_at: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'link-1',
          address: 'ADDR',
          verified_at: new Date(),
          verification_method: 'ed25519_challenge_v1',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await expect(
      service.verifyWallet(
        { wallet_link_id: 'link-1', signature: 'signature' },
        admin,
      ),
    ).resolves.toMatchObject({ verification_method: 'ed25519_challenge_v1' });
    expect(algorand.verifyOwnership).toHaveBeenCalledWith(
      'ADDR',
      'signed',
      'signature',
    );
    expect(db.query.mock.calls[0][1]).toEqual(['link-1', 'org-1', 'actor-1']);
  });

  it('rejects invalid wallet signatures without consuming the challenge', async () => {
    algorand.verifyOwnership.mockReturnValueOnce(false);
    db.query.mockResolvedValueOnce([
      {
        id: 'link-1',
        address: 'ADDR',
        verification_challenge: 'signed',
        challenge_expires_at: new Date(Date.now() + 60_000),
        challenge_consumed_at: null,
      },
    ]);
    await expect(
      service.verifyWallet(
        { wallet_link_id: 'link-1', signature: 'bad' },
        admin,
      ),
    ).rejects.toThrow('invalid wallet ownership signature');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('rejects replayed wallet challenges', async () => {
    db.query.mockResolvedValueOnce([
      {
        id: 'link-1',
        challenge_consumed_at: new Date(),
        challenge_expires_at: new Date(Date.now() + 60_000),
      },
    ]);
    await expect(
      service.verifyWallet(
        { wallet_link_id: 'link-1', signature: 'signature' },
        admin,
      ),
    ).rejects.toThrow('already been consumed');
    expect(algorand.verifyOwnership).not.toHaveBeenCalled();
  });

  it('hides wallet challenges owned by another identity or organization', async () => {
    db.query.mockResolvedValueOnce([]);
    await expect(
      service.verifyWallet(
        { wallet_link_id: 'foreign', signature: 'signature' },
        admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.query.mock.calls[0][1]).toEqual(['foreign', 'org-1', 'actor-1']);
  });

  it('rejects release before milestone approval', async () => {
    db.query
      .mockResolvedValueOnce([
        { id: 'milestone-1', program_id: 'program-1', status: 'under_review' },
      ])
      .mockResolvedValueOnce([{ id: 'program-1', funding_mode: 'managed' }])
      .mockResolvedValueOnce([{ id: 'program-1', funding_mode: 'managed' }]);
    await expect(service.release('milestone-1', {}, admin)).rejects.toThrow(
      'approval threshold',
    );
  });

  it('requires a verified funding transaction for an on-chain allocation', async () => {
    db.query
      .mockResolvedValueOnce([
        {
          id: 'milestone-1',
          program_id: 'program-1',
          currency: 'USD',
          allocated_amount: '10',
        },
      ])
      .mockResolvedValueOnce([
        { id: 'program-1', funding_mode: 'on_chain', currency: 'USD' },
      ])
      .mockResolvedValueOnce([
        { id: 'program-1', funding_mode: 'on_chain', currency: 'USD' },
      ])
      .mockResolvedValueOnce([{ setting_value: true }]);
    await expect(
      service.allocate('milestone-1', { amount: 10, currency: 'USD' }, admin),
    ).rejects.toThrow('chain_transaction_id is required');
  });

  it('rejects unauthorized escrow allocation before database access', async () => {
    await expect(
      service.allocate('milestone-1', { amount: 10, currency: 'USD' }, client),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects invalid application state transitions while holding a row lock', async () => {
    db.query.mockResolvedValueOnce([
      {
        id: 'application-1',
        organization_id: 'org-1',
        applicant_id: 'client-1',
        status: 'completed',
      },
    ]);
    await expect(
      service.transitionApplication(
        'application-1',
        { status: 'submitted' },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(db.query.mock.calls[0][1]).toEqual(['application-1', 'org-1']);
  });

  it('prevents an applicant from approving their own funding', async () => {
    db.query.mockResolvedValueOnce([
      {
        id: 'application-1',
        applicant_id: 'client-1',
        status: 'under_review',
        requested_amount: '10',
      },
    ]);
    await expect(
      service.transitionApplication(
        'application-1',
        { status: 'approved' },
        client,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scopes supporting evidence to organization and client case ownership', async () => {
    db.query
      .mockResolvedValueOnce([{ id: 'program-1' }])
      .mockResolvedValueOnce([]);
    await expect(
      service.linkSupportingDocument(
        'program-1',
        { evidence_id: 'foreign-evidence' },
        client,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.query.mock.calls[1][0]).toContain('organization_id=$2');
    expect(db.query.mock.calls[1][1]).toEqual([
      'foreign-evidence',
      'org-1',
      'client',
      'case-1',
    ]);
  });

  it('locks allocations during concurrent release preparation and does not write a ledger entry', async () => {
    db.query
      .mockResolvedValueOnce([
        { id: 'milestone-1', program_id: 'program-1', status: 'approved' },
      ])
      .mockResolvedValueOnce([{ id: 'program-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'allocation-1', amount: '10', currency: 'USD' },
      ])
      .mockResolvedValueOnce([{ id: 'release-1', status: 'release_requested' }])
      .mockResolvedValue([]);
    await expect(
      service.prepareRelease('milestone-1', {}, admin),
    ).resolves.toMatchObject({ id: 'release-1' });
    expect(
      db.query.mock.calls.some((call) =>
        String(call[0]).includes("status='committed' FOR UPDATE"),
      ),
    ).toBe(true);
    expect(
      db.query.mock.calls.some((call) =>
        String(call[0]).includes('treasury_ledger_entries'),
      ),
    ).toBe(false);
  });

  it('does not allow manual workflow to fabricate disbursement completion', async () => {
    await expect(
      service.transitionRelease('release-1', { status: 'disbursed' }, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('completes an authorized prepared release in place with exactly one ledger write and audit history', async () => {
    db.query
      .mockResolvedValueOnce([
        {
          id: 'milestone-1',
          program_id: 'program-1',
          status: 'approved',
          challenge_ends_at: null,
        },
      ])
      .mockResolvedValueOnce([
        { id: 'program-1', funding_mode: 'managed', case_id: 'case-1' },
      ])
      .mockResolvedValueOnce([
        { id: 'program-1', funding_mode: 'managed', case_id: 'case-1' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'allocation-1',
          treasury_account_id: 'treasury-1',
          amount: '10',
          currency: 'USD',
          status: 'release_pending',
        },
      ])
      .mockResolvedValueOnce([{ id: 'ledger-1' }])
      .mockResolvedValueOnce([
        { id: 'release-1', status: 'release_authorized' },
      ])
      .mockResolvedValueOnce([
        {
          id: 'release-1',
          status: 'disbursed',
          treasury_ledger_entry_id: 'ledger-1',
        },
      ])
      .mockResolvedValue([]);
    await expect(
      service.release('milestone-1', {}, admin),
    ).resolves.toMatchObject({ id: 'release-1', status: 'disbursed' });
    const sql = db.query.mock.calls.map((call) => String(call[0]));
    expect(
      sql.filter((query) =>
        query.includes('INSERT INTO public.treasury_ledger_entries'),
      ),
    ).toHaveLength(1);
    expect(
      sql.filter((query) =>
        query.includes('INSERT INTO public.funding_releases'),
      ),
    ).toHaveLength(0);
    expect(
      sql.filter((query) =>
        query.includes("UPDATE public.funding_releases SET status='disbursed'"),
      ),
    ).toHaveLength(1);
    expect(
      sql.some((query) =>
        query.includes('INSERT INTO public.funding_release_status_history'),
      ),
    ).toBe(true);
    expect(
      sql.some((query) => query.includes("'funding.release.completed'")),
    ).toBe(false);
    expect(
      db.query.mock.calls.some(
        (call) =>
          call[1]?.[0] === 'org-1' && String(call[0]).includes('audit_logs'),
      ),
    ).toBe(true);
  });

  it('rejects duplicate completion before another ledger write', async () => {
    db.query
      .mockResolvedValueOnce([
        { id: 'milestone-1', program_id: 'program-1', status: 'released' },
      ])
      .mockResolvedValueOnce([{ id: 'program-1', funding_mode: 'managed' }])
      .mockResolvedValueOnce([{ id: 'program-1', funding_mode: 'managed' }]);
    await expect(service.release('milestone-1', {}, admin)).rejects.toThrow(
      'approval threshold',
    );
    expect(
      db.query.mock.calls.some((call) =>
        String(call[0]).includes('treasury_ledger_entries'),
      ),
    ).toBe(false);
  });
});
