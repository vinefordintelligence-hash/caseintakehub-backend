import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { SupabaseIdentityService } from '../identity/supabase-identity.service';

const adminActor = {
  actorId: 'a0000000-0000-4000-8000-000000000001',
  role: 'admin',
  organizationId: 'org-1',
  supabaseUserId: 'a0000000-0000-4000-8000-000000000001',
  name: 'Admin',
  email: 'admin@vineford.com',
};

describe('AuditLogsController', () => {
  let controller: AuditLogsController;
  let serviceMock: { findAll: jest.Mock; count: jest.Mock; create: jest.Mock };

  beforeEach(async () => {
    serviceMock = {
      findAll: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'a1' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogsController],
      providers: [
        { provide: AuditLogsService, useValue: serviceMock },
        { provide: SupabaseIdentityService, useValue: { verify: jest.fn() } },
      ],
    }).compile();
    controller = module.get<AuditLogsController>(AuditLogsController);
  });

  it('lists audit entries scoped to the actor organization', async () => {
    const result = await controller.findAll({}, adminActor);
    expect(result).toEqual({ items: [], total: 0 });
    expect(serviceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1' }),
    );
  });

  it('exports the audit log as CSV text', async () => {
    serviceMock.findAll.mockResolvedValue([
      {
        created_at: '2026-08-16T00:00:00Z',
        user_email: 'admin@vineford.com',
        action: 'workflow.advance',
        resource_type: 'case',
        resource_id: 'case-1',
        case_id: 'case-1',
        changes: { phase: 'documents_verified' },
      },
    ]);
    const csv = await controller.export({}, adminActor);
    expect(csv).toContain('created_at,actor,action');
    expect(csv).toContain('workflow.advance');
  });

  it('writes an audit entry for an administrator', async () => {
    await controller.create(
      {
        action: 'case.export',
        resource_type: 'case',
        resource_id: 'case-1',
      },
      adminActor,
    );
    expect(serviceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'a0000000-0000-4000-8000-000000000001',
        action: 'case.export',
      }),
    );
  });

  it('ignores caller-supplied actor and organization identities for audit writes', async () => {
    await controller.create(
      {
        organization_id: 'b0000000-0000-4000-8000-000000000001',
        user_id: 'b0000000-0000-4000-8000-000000000002',
        action: 'security.review',
        resource_type: 'security',
        resource_id: 'review-1',
      },
      adminActor,
    );
    expect(serviceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: adminActor.organizationId,
        userId: adminActor.actorId,
      }),
    );
  });
});
