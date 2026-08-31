import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PERMISSION_DEFINITIONS,
  PermissionsService,
} from './permissions.service';

const admin = {
  actorId: 'admin-a',
  organizationId: 'org-a',
  role: 'super_admin',
  supabaseUserId: 'sup-a',
};

describe('PermissionsService', () => {
  it('falls back to the approved matrix only when migration 0023 is absent', async () => {
    const query = jest.fn().mockRejectedValue({ code: '42P01' });
    const service = new PermissionsService({ query } as never);
    await expect(service.permissionsFor('staff')).resolves.toContain(
      'cases.read',
    );
    await expect(service.permissionsFor('staff')).resolves.not.toContain(
      'cases.update',
    );
  });

  it('uses persisted grants when the mapping exists', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([{ permission_key: 'cases.read' }]);
    const service = new PermissionsService({ query } as never);
    await expect(service.permissionsFor('staff')).resolves.toEqual([
      'cases.read',
    ]);
  });

  it('never permits modification of super-admin wildcard authority', async () => {
    const service = new PermissionsService({} as never);
    await expect(
      service.update('super_admin', { permissions: [] }, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('writes mapping replacement and audit history atomically', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ permission_key: 'cases.read' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { permission_key: 'cases.read' },
          { permission_key: 'documents.read' },
        ]),
    };
    const data = { transaction: jest.fn((work) => work(manager)) };
    const service = new PermissionsService(data as never);
    const result = await service.update(
      'staff',
      { permissions: ['documents.read', 'cases.read'] },
      admin,
    );
    expect(result).toEqual(
      expect.objectContaining({ role: 'staff', persisted: true }),
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('ROLE_PERMISSIONS_CHANGED'),
      expect.any(Array),
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('resource_id'),
      expect.arrayContaining([admin.actorId]),
    );
  });

  it('reports a pending migration instead of silently accepting a write', async () => {
    const data = {
      transaction: jest.fn().mockRejectedValue({ code: '42P01' }),
    };
    const service = new PermissionsService(data as never);
    await expect(
      service.update('staff', { permissions: ['cases.read'] }, admin),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('contains every approved permission concept', () => {
    expect(PERMISSION_DEFINITIONS).toEqual(
      expect.arrayContaining([
        'cases.read',
        'cases.create',
        'cases.update',
        'cases.assign',
        'documents.read',
        'documents.upload',
        'documents.verify',
        'evidence.read',
        'evidence.manage',
        'messages.read',
        'messages.send',
        'reports.read',
        'reports.generate',
        'audit.read',
        'users.manage',
        'organizations.manage',
      ]),
    );
  });
});
