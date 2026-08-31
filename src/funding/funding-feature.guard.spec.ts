import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common/interfaces';
import { FundingFeatureGuard } from './funding-feature.guard';

const context = () =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        vfIdentity: {
          actorId: 'a',
          organizationId: 'org-a',
          role: 'admin',
          supabaseUserId: 's',
        },
      }),
    }),
    getHandler: () => 'handler',
    getClass: () => 'class',
  }) as unknown as ExecutionContext;

describe('FundingFeatureGuard', () => {
  it('returns 403 when a required feature is disabled', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['fundingEnabled']),
    };
    const policy = {
      require: jest
        .fn()
        .mockRejectedValue(
          new ForbiddenException('fundingEnabled is disabled'),
        ),
    };
    const guard = new FundingFeatureGuard(reflector as any, policy as any);
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('enforces the exact endpoint feature metadata', async () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue(['walletConnectionsEnabled']),
    };
    const policy = { require: jest.fn().mockResolvedValue(undefined) };
    const guard = new FundingFeatureGuard(reflector as any, policy as any);
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(policy.require).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a' }),
      ['walletConnectionsEnabled'],
    );
  });
});
