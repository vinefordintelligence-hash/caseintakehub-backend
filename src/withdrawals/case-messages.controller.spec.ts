import { Test, TestingModule } from '@nestjs/testing';
import { CaseMessagesController } from './case-messages.controller';
import { WithdrawalsService } from './withdrawals.service';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { SupabaseIdentityService } from '../identity/supabase-identity.service';

const messagesServiceMock = {
  sendMessage: jest.fn(),
  getMessages: jest.fn(),
};

const CASE_A = '7b2abe2a-9312-42b8-a48d-408fd1771b77';
const CLIENT_ACTOR = 'a0000000-0000-4000-8000-000000000002';

describe('CaseMessagesController', () => {
  let controller: CaseMessagesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CaseMessagesController],
      providers: [
        {
          provide: WithdrawalsService,
          useValue: messagesServiceMock,
        },
        {
          provide: SupabaseIdentityGuard,
          useValue: { canActivate: jest.fn() },
        },
        { provide: SupabaseIdentityService, useValue: { verify: jest.fn() } },
      ],
    }).compile();

    controller = module.get<CaseMessagesController>(CaseMessagesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('31. reads the case-scoped messaging thread', async () => {
    await controller.getMessages(CASE_A, 'client', {
      vfIdentity: {
        actorId: CLIENT_ACTOR,
        organizationId: 'org-a',
        role: 'client',
        supabaseUserId: '',
        caseId: CASE_A,
      },
    } as never);
    expect(messagesServiceMock.getMessages).toHaveBeenCalledWith(
      CASE_A,
      'client',
      CLIENT_ACTOR,
    );
  });

  it('31b. sends a message within the authenticated case context', async () => {
    await controller.sendMessage(
      CASE_A,
      {
        content: 'Hello, please review my request.',
      },
      {
        vfIdentity: {
          actorId: CLIENT_ACTOR,
          organizationId: 'org-a',
          role: 'client',
          supabaseUserId: '',
          caseId: CASE_A,
        },
      } as never,
    );
    expect(messagesServiceMock.sendMessage).toHaveBeenCalledWith(
      CASE_A,
      CLIENT_ACTOR,
      'Hello, please review my request.',
    );
  });
});
