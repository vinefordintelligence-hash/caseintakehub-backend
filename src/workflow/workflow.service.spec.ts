import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { WorkflowService } from './workflow.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationCenterService } from '../notification-center/notification-center.service';

const mockDataSource = {
  query: jest
    .fn()
    .mockResolvedValue([{ result: { workflow_phase: 'completed' } }]),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('signed.handoff.token'),
  verify: jest.fn().mockReturnValue({
    grant_id: '11111111-2222-3333-4444-555555555555',
    case_id: '7b2abe2a-9312-42b8-a48d-408fd1771b77',
    purpose: 'phase6_handoff',
    sandbox: true,
  }),
};

const mockAuditLogsService = {
  create: jest.fn().mockResolvedValue({ id: 'audit-log-id' }),
};

const mockNotificationCenterService = {
  create: jest.fn().mockResolvedValue({ id: 'notification-id' }),
};

describe('WorkflowService', () => {
  let service: WorkflowService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: JwtService, useValue: mockJwtService },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        {
          provide: NotificationCenterService,
          useValue: mockNotificationCenterService,
        },
      ],
    }).compile();

    service = module.get<WorkflowService>(WorkflowService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns workflow state for a case', async () => {
    const result = await service.getCaseWorkflow(
      '7b2abe2a-9312-42b8-a48d-408fd1771b77',
    );
    expect(result).toEqual({ workflow_phase: 'completed' });
  });

  it('passes the requested view to vf_get_case_workflow', async () => {
    await service.getCaseWorkflow(
      '7b2abe2a-9312-42b8-a48d-408fd1771b77',
      'client',
    );
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_get_case_workflow'),
      ['7b2abe2a-9312-42b8-a48d-408fd1771b77', 'client'],
    );
  });

  it('5. client-view read is denied when the actor is not authorized for the case', async () => {
    mockDataSource.query.mockResolvedValueOnce([{ allowed: false }]);

    await expect(
      service.getCaseWorkflow(
        '7b2abe2a-9312-42b8-a48d-408fd1771b77',
        'client',
        'a0000000-0000-4000-8000-000000000002',
      ),
    ).rejects.toThrow(/not authorized for case/);
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_actor_can_access_case'),
      [
        'a0000000-0000-4000-8000-000000000002',
        '7b2abe2a-9312-42b8-a48d-408fd1771b77',
      ],
    );
  });

  it('5b. client-view read is allowed when the actor is the case client', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([{ allowed: true }])
      .mockResolvedValueOnce([{ result: { workflow_phase: 'completed' } }]);

    const result = await service.getCaseWorkflow(
      '7b2abe2a-9312-42b8-a48d-408fd1771b77',
      'client',
      'a0000000-0000-4000-8000-000000000002',
    );
    expect(result).toEqual({ workflow_phase: 'completed' });
    expect(mockDataSource.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('vf_actor_can_access_case'),
      expect.anything(),
    );
    expect(mockDataSource.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('vf_get_case_workflow'),
      expect.anything(),
    );
  });

  it('7. admin-view reads remain available to internal roles', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([{ allowed: true }])
      .mockResolvedValueOnce([{ result: { workflow_phase: 'completed' } }]);

    const result = await service.getCaseWorkflow(
      '7b2abe2a-9312-42b8-a48d-408fd1771b77',
      'admin',
      'a0000000-0000-4000-8000-000000000001',
    );
    expect(result).toEqual({ workflow_phase: 'completed' });
    expect(mockDataSource.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('JOIN public.organization_memberships'),
      expect.anything(),
    );
    expect(mockDataSource.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('vf_get_case_workflow'),
      expect.anything(),
    );
    expect(mockDataSource.query).not.toHaveBeenCalledWith(
      expect.stringContaining('vf_actor_can_access_case'),
      expect.anything(),
    );
  });

  it('7b. a client actor is denied the admin view', async () => {
    mockDataSource.query.mockResolvedValueOnce([{ allowed: false }]);

    await expect(
      service.getCaseWorkflow(
        '7b2abe2a-9312-42b8-a48d-408fd1771b77',
        'admin',
        'a0000000-0000-4000-8000-000000000002',
      ),
    ).rejects.toThrow(/not authorized for the admin case view/);
  });

  it('7c. an unknown actor is denied the admin view', async () => {
    mockDataSource.query.mockResolvedValueOnce([{ allowed: false }]);

    await expect(
      service.getCaseWorkflow(
        '7b2abe2a-9312-42b8-a48d-408fd1771b77',
        'admin',
        '11111111-1111-4111-8111-111111111111',
      ),
    ).rejects.toThrow(/not authorized for the admin case view/);
  });

  it('returns the chronological timeline for a case', async () => {
    const result = await service.getCaseTimeline(
      '7b2abe2a-9312-42b8-a48d-408fd1771b77',
    );
    expect(result).toEqual({ workflow_phase: 'completed' });
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_get_case_timeline'),
      ['7b2abe2a-9312-42b8-a48d-408fd1771b77', 'admin'],
    );
  });

  it('9. PHASE 6 cannot unlock before admin approval (DB gate raises)', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      { organization_id: 'a66e5f92-5c3c-42d5-b270-fba206ef5c0b' },
    ]);
    mockDataSource.query.mockRejectedValueOnce(
      new Error(
        'next authorized client action cannot be created: 1 active verification requirement(s) are not VERIFIED',
      ),
    );
    await expect(
      service.createClientAction(
        '7b2abe2a-9312-42b8-a48d-408fd1771b77',
        'a0000000-0000-4000-8000-000000000001',
        {
          title: 'Next Authorized Client Action',
        },
      ),
    ).rejects.toThrow(/active verification requirements must be verified/);
  });

  it('9b. maps the phase-five workflow gate to a safe conflict', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      { organization_id: 'a66e5f92-5c3c-42d5-b270-fba206ef5c0b' },
    ]);
    mockDataSource.query.mockRejectedValueOnce(
      new Error(
        'next authorized client action cannot be created: required verification (phase 5) is not complete',
      ),
    );
    await expect(
      service.createClientAction(
        '7b2abe2a-9312-42b8-a48d-408fd1771b77',
        'a0000000-0000-4000-8000-000000000001',
        { title: 'Next Authorized Client Action' },
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('9c. does not hide unexpected client-action database failures', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      { organization_id: 'a66e5f92-5c3c-42d5-b270-fba206ef5c0b' },
    ]);
    mockDataSource.query.mockRejectedValueOnce(
      new Error('unexpected database failure'),
    );
    await expect(
      service.createClientAction(
        '7b2abe2a-9312-42b8-a48d-408fd1771b77',
        'a0000000-0000-4000-8000-000000000001',
        { title: 'Next Authorized Client Action' },
      ),
    ).rejects.toThrow('unexpected database failure');
  });

  it('16d. issues a Phase 6 handoff and signs + stores the token', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      {
        result: {
          grant_id: '11111111-2222-3333-4444-555555555555',
          case_id: '7b2abe2a-9312-42b8-a48d-408fd1771b77',
          case_number: 'VF-2026-8282',
          organization_id: 'a66e5f92-5c3c-42d5-b270-fba206ef5c0b',
          action_id: '35953304-8b6e-4cc0-a824-cf6d8ed5748e',
          approved_at: '2026-08-15T00:19:51.000Z',
          unlocked_at: '2026-08-15T00:19:57.000Z',
          expires_at: '2026-09-14T00:00:00.000Z',
          status: 'active',
          sandbox: true,
        },
      },
    ]);
    mockDataSource.query.mockResolvedValueOnce([
      {
        result: {
          grant_id: '11111111-2222-3333-4444-555555555555',
          status: 'active',
        },
      },
    ]);

    const result = await service.issuePhase6Handoff(
      '7b2abe2a-9312-42b8-a48d-408fd1771b77',
      'a0000000-0000-4000-8000-000000000001',
      { action_id: '35953304-8b6e-4cc0-a824-cf6d8ed5748e' },
    );

    expect(result?.token).toBe('signed.handoff.token');
    expect(mockDataSource.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('vf_issue_phase6_handoff'),
      [
        '7b2abe2a-9312-42b8-a48d-408fd1771b77',
        'a0000000-0000-4000-8000-000000000001',
        '35953304-8b6e-4cc0-a824-cf6d8ed5748e',
      ],
    );
    expect(mockDataSource.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('vf_store_phase6_handoff_token'),
      ['11111111-2222-3333-4444-555555555555', 'signed.handoff.token'],
    );
    expect(mockJwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        grant_id: '11111111-2222-3333-4444-555555555555',
        purpose: 'phase6_handoff',
        sandbox: true,
      }),
      expect.anything(),
    );
  });

  it('16e. verifies a Phase 6 handoff token against live workflow state', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      {
        result: {
          grant_id: '11111111-2222-3333-4444-555555555555',
          status: 'active',
          verified_count: 1,
          sandbox: true,
          simulated: true,
          disclaimer:
            'SANDBOX / DEMO workflow. This is simulated functionality only',
        },
      },
    ]);

    const result = await service.verifyPhase6Handoff(
      { token: 'signed.handoff.token' },
      'a0000000-0000-4000-8000-000000000002',
    );

    expect(result?.verified_count).toBe(1);
    expect(mockJwtService.verify).toHaveBeenCalledWith('signed.handoff.token');
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_verify_phase6_handoff'),
      [
        '11111111-2222-3333-4444-555555555555',
        'signed.handoff.token',
        'a0000000-0000-4000-8000-000000000002',
      ],
    );
  });

  it('16f. rejects a tampered or expired handoff token', async () => {
    mockJwtService.verify.mockImplementationOnce(() => {
      throw new Error('jwt expired');
    });

    await expect(
      service.verifyPhase6Handoff({ token: 'bad.token' }),
    ).rejects.toThrow(/invalid or expired/);
    expect(mockDataSource.query).not.toHaveBeenCalled();
  });

  it('16g. revokes a Phase 6 handoff grant (admin only)', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      {
        result: {
          grant_id: '11111111-2222-3333-4444-555555555555',
          status: 'revoked',
        },
      },
    ]);

    const result = await service.revokePhase6Handoff(
      '11111111-2222-3333-4444-555555555555',
      'a0000000-0000-4000-8000-000000000001',
      'case reopened',
    );

    expect(result?.status).toBe('revoked');
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_revoke_phase6_handoff'),
      [
        '11111111-2222-3333-4444-555555555555',
        'a0000000-0000-4000-8000-000000000001',
        'case reopened',
      ],
    );
  });

  it('16h. reads the Phase 6 handoff status read model', async () => {
    const result = await service.getPhase6HandoffStatus(
      '7b2abe2a-9312-42b8-a48d-408fd1771b77',
      'client',
    );
    expect(result).toEqual({ workflow_phase: 'completed' });
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('vf_get_phase6_handoff_status'),
      ['7b2abe2a-9312-42b8-a48d-408fd1771b77', 'client'],
    );
  });

  it('16i. places a legal hold for an administrator and audits it', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([{ role: 'admin' }])
      .mockResolvedValueOnce([
        { organization_id: 'org-1', legal_hold: false, legal_hold_note: null },
      ]);

    const result = await service.setLegalHold(
      '7b2abe2a-9312-42b8-a48d-408fd1771b77',
      'a0000000-0000-4000-8000-000000000001',
      { enabled: true, note: 'Frozen pending confirmation' },
    );

    expect(result).toEqual({
      legal_hold: true,
      note: 'Frozen pending confirmation',
    });
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('SET legal_hold = $1'),
      [
        true,
        'Frozen pending confirmation',
        '7b2abe2a-9312-42b8-a48d-408fd1771b77',
      ],
    );
    expect(mockAuditLogsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'case.legal_hold_placed' }),
    );
    expect(mockNotificationCenterService.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Your case is under legal hold' }),
    );
  });

  it('16j. a client actor cannot place a legal hold', async () => {
    mockDataSource.query.mockResolvedValueOnce([{ role: 'client' }]);

    await expect(
      service.setLegalHold(
        '7b2abe2a-9312-42b8-a48d-408fd1771b77',
        'a0000000-0000-4000-8000-000000000002',
        { enabled: true },
      ),
    ).rejects.toThrow(/administrator access required/);
    expect(mockDataSource.query).toHaveBeenCalledTimes(1);
  });
});
