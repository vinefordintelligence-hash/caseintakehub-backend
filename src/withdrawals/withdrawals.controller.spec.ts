import { Test, TestingModule } from '@nestjs/testing';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';
import { SupabaseIdentityService } from '../identity/supabase-identity.service';

const withdrawalsServiceMock = {
  submit: jest.fn(),
  findByCase: jest.fn(),
  findOne: jest.fn(),
  list: jest.fn(),
  decision: jest.fn(),
  respond: jest.fn(),
};

const CASE_A = '7b2abe2a-9312-42b8-a48d-408fd1771b77';
const REQUEST_ID = '22222222-3333-4444-5555-666666666666';
const CLIENT_ACTOR = 'a0000000-0000-4000-8000-000000000002';
const ADMIN_ACTOR = 'a0000000-0000-4000-8000-000000000001';

describe('WithdrawalsController', () => {
  let controller: WithdrawalsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WithdrawalsController],
      providers: [
        { provide: SupabaseIdentityService, useValue: { verify: jest.fn() } },
        {
          provide: WithdrawalsService,
          useValue: withdrawalsServiceMock,
        },
      ],
    }).compile();

    controller = module.get<WithdrawalsController>(WithdrawalsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('29. submits a withdrawal request with the actor header and case from the body', async () => {
    const dto = {
      case_id: CASE_A,
      handoff_token: 'signed.handoff.token',
      amount: 114000,
    };
    await controller.submit(CLIENT_ACTOR, dto);
    expect(withdrawalsServiceMock.submit).toHaveBeenCalledWith(
      CASE_A,
      CLIENT_ACTOR,
      dto,
    );
  });

  it('29b. lists requests for a case with a client view', async () => {
    await controller.findByCase(CASE_A, 'client', CLIENT_ACTOR);
    expect(withdrawalsServiceMock.findByCase).toHaveBeenCalledWith(
      CASE_A,
      'client',
      CLIENT_ACTOR,
    );
  });

  it('29c. lists the admin review queue with a status filter', async () => {
    await controller.list(ADMIN_ACTOR, 'pending_review');
    expect(withdrawalsServiceMock.list).toHaveBeenCalledWith(
      ADMIN_ACTOR,
      'pending_review',
    );
  });

  it('29d. reads a single request', async () => {
    await controller.findOne(REQUEST_ID, 'admin', ADMIN_ACTOR);
    expect(withdrawalsServiceMock.findOne).toHaveBeenCalledWith(
      REQUEST_ID,
      'admin',
      ADMIN_ACTOR,
    );
  });

  it('30. admin decision is wired to the decision endpoint', async () => {
    await controller.decision(REQUEST_ID, ADMIN_ACTOR, {
      decision: 'approve',
    });
    expect(withdrawalsServiceMock.decision).toHaveBeenCalledWith(
      REQUEST_ID,
      ADMIN_ACTOR,
      { decision: 'approve' },
    );
  });

  it('30b. client respond is wired to the respond endpoint', async () => {
    await controller.respond(REQUEST_ID, CLIENT_ACTOR, {
      response: 'Legal name confirmed.',
    });
    expect(withdrawalsServiceMock.respond).toHaveBeenCalledWith(
      REQUEST_ID,
      CLIENT_ACTOR,
      'Legal name confirmed.',
    );
  });
});
