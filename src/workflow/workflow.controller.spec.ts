import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { SupabaseIdentityService } from '../identity/supabase-identity.service';

const workflowServiceMock = {
  getCaseWorkflow: jest.fn(),
  getCaseTimeline: jest.fn(),
  getCaseHistory: jest.fn(),
  advancePhase: jest.fn(),
  completeReview: jest.fn(),
  createClientAction: jest.fn(),
  findClientActions: jest.fn(),
  findClientAction: jest.fn(),
  getPhase6HandoffStatus: jest.fn(),
  issuePhase6Handoff: jest.fn(),
  verifyPhase6Handoff: jest.fn(),
  revokePhase6Handoff: jest.fn(),
};

describe('WorkflowController', () => {
  const mockReq = {
    vfIdentity: {
      actorId: 'a0000000-0000-4000-8000-000000000001',
      organizationId: 'b0000000-0000-4000-8000-000000000001',
      role: 'admin',
    },
  } as any;

  let controller: WorkflowController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkflowController],
      providers: [
        { provide: SupabaseIdentityService, useValue: { verify: jest.fn() } },
        {
          provide: WorkflowService,
          useValue: workflowServiceMock,
        },
      ],
    }).compile();

    controller = module.get<WorkflowController>(WorkflowController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('issues a Phase 6 handoff for an approved case', async () => {
    await controller.issuePhase6Handoff(
      '7b2abe2a-9312-42b8-a48d-408fd1771b77',
      mockReq,
      { action_id: '35953304-8b6e-4cc0-a824-cf6d8ed5748e' },
    );
    expect(workflowServiceMock.issuePhase6Handoff).toHaveBeenCalledWith(
      '7b2abe2a-9312-42b8-a48d-408fd1771b77',
      'a0000000-0000-4000-8000-000000000001',
      { action_id: '35953304-8b6e-4cc0-a824-cf6d8ed5748e' },
    );
  });

  it('verifies a Phase 6 handoff token', async () => {
    await controller.verifyPhase6Handoff(mockReq, {
      token: 'signed.handoff.token',
    });
    expect(workflowServiceMock.verifyPhase6Handoff).toHaveBeenCalledWith(
      { token: 'signed.handoff.token' },
      'a0000000-0000-4000-8000-000000000001',
    );
  });

  it('revokes a Phase 6 handoff grant', async () => {
    await controller.revokePhase6Handoff(
      '11111111-2222-3333-4444-555555555555',
      mockReq,
      { note: 'reopened' },
    );
    expect(workflowServiceMock.revokePhase6Handoff).toHaveBeenCalledWith(
      '11111111-2222-3333-4444-555555555555',
      'a0000000-0000-4000-8000-000000000001',
      'reopened',
    );
  });

  it('reads the Phase 6 handoff status', async () => {
    await controller.getPhase6HandoffStatus(
      '7b2abe2a-9312-42b8-a48d-408fd1771b77',
      mockReq,
      'client',
    );
    expect(workflowServiceMock.getPhase6HandoffStatus).toHaveBeenCalledWith(
      '7b2abe2a-9312-42b8-a48d-408fd1771b77',
      'client',
      'a0000000-0000-4000-8000-000000000001',
    );
  });
});
