import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

const admin = {
  actorId: 'a0000000-0000-4000-8000-000000000001',
  organizationId: 'a66e5f92-5c3c-42d5-b270-fba206ef5c0b',
  role: 'admin',
  supabaseUserId: 'supabase-admin',
};
const superAdmin = { ...admin, role: 'super_admin' };
const target = {
  id: 'b0000000-0000-4000-8000-000000000001',
  name: 'Investigator One',
  email: 'investigator@example.test',
  role: 'investigator',
  is_active: true,
};

describe('UsersService', () => {
  it('creates a local staff account, membership, and audit record atomically', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([target])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    const data = { transaction: jest.fn((work) => work(manager)) };
    const service = new UsersService(data as never);
    const result = await service.create(
      {
        name: ' Investigator One ',
        email: 'INVESTIGATOR@example.test',
        role: 'investigator',
      },
      admin,
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: target.id,
        identity_linked: false,
        membership_status: 'active',
      }),
    );
    expect(manager.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO public.app_users'),
      [
        admin.organizationId,
        'Investigator One',
        'investigator@example.test',
        'investigator',
      ],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.audit_logs'),
      expect.arrayContaining(['USER_CREATED']),
    );
  });

  it('prevents an organization admin from creating privileged or client identities', async () => {
    const service = new UsersService({} as never);
    await expect(
      service.create(
        { name: 'Admin', email: 'admin@example.test', role: 'admin' },
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.create(
        { name: 'Client', email: 'client@example.test', role: 'client' },
        superAdmin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lists users only through the verified organization scope with bounded filters', async () => {
    const query = jest.fn().mockResolvedValue([target]);
    const service = new UsersService({ query } as never);
    const result = await service.findAll(
      { ...admin, role: 'staff' },
      {
        role: 'investigator',
        status: 'active',
        search: 'Investigator',
        limit: 20,
        offset: 0,
      },
    );
    expect(result.items).toEqual([target]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('u.organization_id=$1'),
      expect.arrayContaining([admin.organizationId]),
    );
    expect(String(query.mock.calls[0][0])).not.toContain('SELECT *');
  });

  it('allows non-admin staff to read only their own detailed profile', async () => {
    const service = new UsersService({ query: jest.fn() } as never);
    await expect(
      service.findOne(target.id, { ...admin, role: 'staff' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('synchronizes deactivation and preserves history through non-destructive updates', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([target])
        .mockResolvedValueOnce([{ ...target, is_active: false }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    const service = new UsersService({
      transaction: jest.fn((work) => work(manager)),
    } as never);
    await expect(service.remove(target.id, admin)).resolves.toEqual(
      expect.objectContaining({ is_active: false }),
    );
    const sql = manager.query.mock.calls
      .map((call) => String(call[0]))
      .join('\n');
    expect(sql).toContain('UPDATE public.app_users');
    expect(sql).toContain('UPDATE public.organization_memberships');
    expect(sql).toContain('UPDATE public.vf_identity_links');
    expect(sql).toContain('UPDATE public.case_assignments');
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.audit_logs'),
      expect.arrayContaining(['USER_DEACTIVATED']),
    );
    expect(sql).not.toContain('DELETE FROM');
  });

  it('prevents self-deactivation and admin management of another administrator', async () => {
    const service = new UsersService({} as never);
    await expect(service.remove(admin.actorId, admin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const manager = {
      query: jest.fn().mockResolvedValueOnce([{ ...target, role: 'admin' }]),
    };
    const scoped = new UsersService({
      transaction: jest.fn((work) => work(manager)),
    } as never);
    await expect(
      scoped.update(target.id, { name: 'Changed' }, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('prevents removal of the last active super administrator', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ ...target, role: 'super_admin' }])
        .mockResolvedValueOnce([{ count: 0 }]),
    };
    const service = new UsersService({
      transaction: jest.fn((work) => work(manager)),
    } as never);
    await expect(
      service.update(target.id, { is_active: false }, superAdmin),
    ).rejects.toThrow(/last active super administrator/);
  });

  it('returns organization-scoped activity and assignments after access validation', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([target])
      .mockResolvedValueOnce([{ action: 'USER_UPDATED' }])
      .mockResolvedValueOnce([{ assignment_role: 'investigator' }]);
    const service = new UsersService({ query } as never);
    const activity = await service.activity(target.id, admin);
    expect(activity.events).toHaveLength(1);
    expect(activity.assignments).toHaveLength(1);
    expect(query.mock.calls[1][1]).toEqual([target.id, admin.organizationId]);
    expect(query.mock.calls[2][1]).toEqual([target.id, admin.organizationId]);
  });
});
