/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unnecessary-type-assertion */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CaseAssignmentsService } from './case-assignments.service';

const admin = {
  actorId: 'a0000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000001',
  role: 'admin',
  supabaseUserId: 'sup-admin',
};
const investigator = {
  ...admin,
  actorId: 'i0000000-0000-4000-8000-000000000001',
  role: 'investigator',
};

describe('CaseAssignmentsService', () => {
  it('enforces admin mutation RBAC before database access', async () => {
    const db = { transaction: jest.fn() };
    const service = new CaseAssignmentsService(db as never);
    await expect(
      service.create({} as never, investigator as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it('scopes investigator overview to self and organization', async () => {
    const query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const service = new CaseAssignmentsService({ query } as never);
    await service.overview(investigator as never, {});
    expect(query.mock.calls[0][1]).toEqual([
      investigator.organizationId,
      investigator.actorId,
    ]);
    expect(query.mock.calls[1][1].slice(0, 2)).toEqual([
      investigator.organizationId,
      investigator.actorId,
    ]);
  });
  it('creates assignment and history in one transaction', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'case' }])
      .mockResolvedValueOnce([{ id: 'staff' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'assignment' }])
      .mockResolvedValueOnce([]);
    const db = {
      transaction: jest.fn((run: (m: { query: typeof query }) => unknown) =>
        run({ query }),
      ),
    };
    const service = new CaseAssignmentsService(db as never);
    await service.create(
      {
        case_id: 'case',
        app_user_id: 'staff',
        assignment_role: 'investigator',
        assignment_kind: 'primary',
      } as never,
      admin as never,
    );
    expect(
      query.mock.calls.some(([sql]) =>
        (sql as string).includes('case_assignment_history'),
      ),
    ).toBe(true);
  });
  it('rejects a missing or cross-organization removal target', async () => {
    const query = jest.fn().mockResolvedValueOnce([]);
    const db = {
      transaction: jest.fn((run: (m: { query: typeof query }) => unknown) =>
        run({ query }),
      ),
    };
    const service = new CaseAssignmentsService(db as never);
    await expect(
      service.remove('missing', { reason: 'test cleanup' }, admin as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
