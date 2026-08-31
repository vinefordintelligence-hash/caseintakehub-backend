import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';

const CASE_A = '7b2abe2a-9312-42b8-a48d-408fd1771b77';
const CLIENT_ACTOR = 'a0000000-0000-4000-8000-000000000002';
const ADMIN_ACTOR = 'a0000000-0000-4000-8000-000000000001';

const mockDataSource = {
  query: jest
    .fn()
    .mockResolvedValue([{ result: { status: 'pending_review' } }]),
  transaction: jest.fn(
    async (fn: (manager: { query: typeof mockDataSource.query }) => unknown) =>
      fn({ query: mockDataSource.query }),
  ),
};

const mockJwtService = {
  verify: jest.fn().mockReturnValue({
    grant_id: '11111111-2222-3333-4444-555555555555',
    case_id: CASE_A,
    case_number: 'VF-2026-8282',
    organization_id: 'a66e5f92-5c3c-42d5-b270-fba206ef5c0b',
    purpose: 'phase6_handoff',
    sandbox: true,
  }),
};

describe('WithdrawalsService', () => {
  let service: WithdrawalsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawalsService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<WithdrawalsService>(WithdrawalsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('18. submits a withdrawal request only after verifying the handoff token claims', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      {
        result: {
          id: '22222222-3333-4444-5555-666666666666',
          case_id: CASE_A,
          status: 'pending_review',
          sandbox: true,
          simulated: true,
        },
      },
    ]);

    const result = await service.submit(CASE_A, CLIENT_ACTOR, {
      case_id: CASE_A,
      handoff_token: 'signed.handoff.token',
      amount: 114000,
      currency: 'USD',
      requested_method: 'bank_transfer',
      beneficiary_name: 'Gayl M. Chenoweth',
      account_number: '003288471199',
      account_type: 'savings',
      routing_number: '021000021',
      client_note: 'Please process',
    });

    expect(result?.status).toBe('pending_review');
    expect(mockJwtService.verify).toHaveBeenCalledWith('signed.handoff.token');
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_submit_withdrawal_after_acceptance'),
      [
        CASE_A,
        CLIENT_ACTOR,
        'signed.handoff.token',
        114000,
        'USD',
        'bank_transfer',
        'Gayl M. Chenoweth',
        '003288471199',
        'savings',
        '021000021',
        'Please process',
      ],
    );
  });

  it('18b. rejects a tampered or expired handoff token before any DB call', async () => {
    mockJwtService.verify.mockImplementationOnce(() => {
      throw new Error('jwt expired');
    });

    await expect(
      service.submit(CASE_A, CLIENT_ACTOR, {
        case_id: CASE_A,
        handoff_token: 'bad.token',
        amount: 100,
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(mockDataSource.query).not.toHaveBeenCalled();
  });

  it('18c. rejects a token whose case does not match the requested case', async () => {
    mockJwtService.verify.mockReturnValueOnce({
      grant_id: '11111111-2222-3333-4444-555555555555',
      case_id: '1a44f91a-8632-4426-92e6-3d6f31b97056',
      purpose: 'phase6_handoff',
      sandbox: true,
    });

    await expect(
      service.submit(CASE_A, CLIENT_ACTOR, {
        case_id: CASE_A,
        handoff_token: 'signed.for.another.case',
        amount: 100,
      }),
    ).rejects.toThrow(/does not authorize this case/);
    expect(mockDataSource.query).not.toHaveBeenCalled();
  });

  it('19. client cannot decide their own request (DB admin gate -> 403)', async () => {
    mockDataSource.query.mockRejectedValueOnce(
      new Error(
        'only administrators can perform this action (actor role: client)',
      ),
    );

    await expect(
      service.decision('22222222-3333-4444-5555-666666666666', CLIENT_ACTOR, {
        decision: 'approve',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('20. admin approval records the decision and never executes a transfer', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      {
        result: {
          id: '22222222-3333-4444-5555-666666666666',
          status: 'approved',
          executed: false,
          sandbox: true,
          simulated: true,
        },
      },
    ]);

    const result = await service.decision(
      '22222222-3333-4444-5555-666666666666',
      ADMIN_ACTOR,
      { decision: 'approve', note: 'approved in control room' },
    );

    expect(result?.status).toBe('approved');
    expect(result?.executed).toBe(false);
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_admin_withdrawal_decision'),
      [
        '22222222-3333-4444-5555-666666666666',
        'approve',
        ADMIN_ACTOR,
        null,
        'approved in control room',
      ],
    );
  });

  it('21. admin rejection requires a stored reason', async () => {
    mockDataSource.query.mockRejectedValueOnce(
      new Error('a reason is required to reject a withdrawal request'),
    );

    await expect(
      service.decision('22222222-3333-4444-5555-666666666666', ADMIN_ACTOR, {
        decision: 'reject',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('22. more-information request carries the client-visible message', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      {
        result: {
          id: '22222222-3333-4444-5555-666666666666',
          status: 'needs_information',
          review_message: 'Please confirm the beneficiary legal name.',
        },
      },
    ]);

    const result = await service.decision(
      '22222222-3333-4444-5555-666666666666',
      ADMIN_ACTOR,
      {
        decision: 'needs_information',
        reason: 'Please confirm the beneficiary legal name.',
      },
    );

    expect(result?.status).toBe('needs_information');
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_admin_withdrawal_decision'),
      [
        '22222222-3333-4444-5555-666666666666',
        'needs_information',
        ADMIN_ACTOR,
        'Please confirm the beneficiary legal name.',
        null,
      ],
    );
  });

  it('23. client response returns the request to pending_review', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      {
        result: {
          id: '22222222-3333-4444-5555-666666666666',
          status: 'pending_review',
          client_response: 'Legal name confirmed: Gayl M. Chenoweth.',
        },
      },
    ]);

    const result = await service.respond(
      '22222222-3333-4444-5555-666666666666',
      CLIENT_ACTOR,
      'Legal name confirmed: Gayl M. Chenoweth.',
    );

    expect(result?.status).toBe('pending_review');
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_respond_to_withdrawal_request'),
      [
        '22222222-3333-4444-5555-666666666666',
        CLIENT_ACTOR,
        'Legal name confirmed: Gayl M. Chenoweth.',
      ],
    );
  });

  it('24. unauthorized actor cannot read a case (DB gate -> 403)', async () => {
    mockDataSource.query.mockRejectedValueOnce(
      new Error(
        'permission denied: actor 99999999-9999-4999-8999-999999999999 is not authorized for case 7b2abe2a-9312-42b8-a48d-408fd1771b77',
      ),
    );

    await expect(
      service.findByCase(
        CASE_A,
        'client',
        '99999999-9999-4999-8999-999999999999',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('25. missing withdrawal request maps to 404', async () => {
    mockDataSource.query.mockRejectedValueOnce(
      new Error(
        'withdrawal request 00000000-0000-4000-8000-000000000000 not found',
      ),
    );

    await expect(
      service.findOne('00000000-0000-4000-8000-000000000000', 'admin'),
    ).rejects.toThrow(NotFoundException);
  });

  it('26. admin list endpoint passes the status filter', async () => {
    await service.list(ADMIN_ACTOR, 'pending_review');
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_list_withdrawal_requests'),
      [ADMIN_ACTOR, 'pending_review'],
    );
  });

  it('27. messages reuse the existing case messaging store', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      {
        result: {
          id: '33333333-4444-5555-6666-777777777777',
          case_id: CASE_A,
          content: 'Hello, please review my request.',
        },
      },
    ]);

    const result = await service.sendMessage(
      CASE_A,
      CLIENT_ACTOR,
      'Hello, please review my request.',
    );

    expect(result?.content).toBe('Hello, please review my request.');
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_send_case_message'),
      [CASE_A, CLIENT_ACTOR, 'Hello, please review my request.'],
    );

    await service.getMessages(CASE_A, 'client', CLIENT_ACTOR);
    expect(mockDataSource.query).toHaveBeenLastCalledWith(
      expect.stringContaining('vf_get_case_messages'),
      [CASE_A, CLIENT_ACTOR, 'client'],
    );
  });

  it('28. unrelated actor cannot message on a case (DB gate -> 403)', async () => {
    mockDataSource.query.mockRejectedValueOnce(
      new Error(
        'permission denied: actor 99999999-9999-4999-8999-999999999999 is not authorized to message on case 7b2abe2a-9312-42b8-a48d-408fd1771b77',
      ),
    );

    await expect(
      service.sendMessage(CASE_A, '99999999-9999-4999-8999-999999999999', 'hi'),
    ).rejects.toThrow(ForbiddenException);
  });
});
