import { ForbiddenException } from '@nestjs/common';
import { ClientPortalAccessGateGuard } from './client-portal-access-gate.guard';

const client = {
  actorId: 'client-a',
  organizationId: 'org-a',
  role: 'client',
  caseId: 'case-a',
  supabaseUserId: 'sup-a',
};
function context(path: string, method = 'GET', role = 'client') {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ path, method, vfIdentity: { ...client, role } }),
    }),
  } as never;
}

describe('ClientPortalAccessGateGuard', () => {
  const locked = { state: jest.fn().mockResolvedValue({ locked: true }) };
  it.each([
    '/case-progress/case-a',
    '/workflow/cases/case-a',
    '/transaction-authorization/cases/case-a',
    '/transaction-authorization/cases/case-a/voided-check',
    '/transaction-authorization/cases/case-a/payment-receipt',
  ])('allows required gate route %s', async (path) => {
    await expect(
      new ClientPortalAccessGateGuard(locked as never).canActivate(
        context(path),
      ),
    ).resolves.toBe(true);
  });
  it.each([
    '/case-progress/case-a/client-workspace/timeline',
    '/case-progress/case-a/client-workspace/documents',
    '/case-progress/case-a/client-workspace/messages',
    '/case-progress/case-a/client-workspace/invoices',
    '/case-progress/case-a/client-workspace/payments',
    '/case-progress/case-a/client-workspace/treasury',
    '/kyc/mine',
    '/cases/case-a/messages',
    '/documents',
    '/timeline',
    '/workflow/client-actions/action-a/acceptance',
  ])('denies protected client route %s', async (path) => {
    await expect(
      new ClientPortalAccessGateGuard(locked as never).canActivate(
        context(path),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not affect staff', async () => {
    locked.state.mockClear();
    await expect(
      new ClientPortalAccessGateGuard(locked as never).canActivate(
        context('/timeline', 'GET', 'admin'),
      ),
    ).resolves.toBe(true);
    expect(locked.state).not.toHaveBeenCalled();
  });
  it('restores all routes when both requirements are verified', async () => {
    const open = { state: jest.fn().mockResolvedValue({ locked: false }) };
    await expect(
      new ClientPortalAccessGateGuard(open as never).canActivate(
        context('/case-progress/case-a/client-workspace/timeline'),
      ),
    ).resolves.toBe(true);
  });
});
