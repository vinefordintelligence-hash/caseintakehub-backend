import {
  ArgumentMetadata,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common/interfaces';
import { Reflector } from '@nestjs/core';
import { ClientLoginDto } from '../../client-auth/dto/client-login.dto';
import { AuthController } from '../../auth/auth.controller';
import { CommunicationsController } from '../../communications/communications.controller';
import { IntegrationsController } from '../../integrations/integrations.controller';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { SupabaseIdentityGuard } from '../../identity/supabase-identity.guard';
import { ClientGuard } from './client.guard';
import { OrganizationGuard } from './organization.guard';
import { RbacGuard } from './rbac.guard';

const identity = {
  actorId: 'actor-a',
  organizationId: 'org-a',
  role: 'admin',
  supabaseUserId: 'sup-a',
};

function context(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

describe('Phase 38A security foundation', () => {
  it('rejects unauthenticated protected requests and permits explicit public routes', async () => {
    const verify = jest.fn();
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValueOnce(false),
    };
    const guard = new SupabaseIdentityGuard(
      { verify } as never,
      reflector as never,
    );
    await expect(
      guard.canActivate(context({ headers: {} })),
    ).rejects.toBeDefined();

    reflector.getAllAndOverride.mockReturnValueOnce(true);
    await expect(guard.canActivate(context({ headers: {} }))).resolves.toBe(
      true,
    );
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('propagates verified identity and never treats a spoofed actor header as authoritative', async () => {
    const verify = jest.fn().mockResolvedValue(identity);
    const request = {
      headers: {
        authorization: 'Bearer verified',
        'x-actor-id': 'spoofed-actor',
        'x-organization-id': 'org-a',
      },
    };
    const guard = new SupabaseIdentityGuard(
      { verify } as never,
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as never,
    );
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith(
      'Bearer verified',
      'spoofed-actor',
      'org-a',
    );
    expect(request.headers['x-actor-id']).toBe(identity.actorId);
    expect(request.headers['x-organization-id']).toBe(identity.organizationId);
    expect(
      (request as typeof request & { vfIdentity: unknown }).vfIdentity,
    ).toBe(identity);
  });

  it('enforces admin and super-admin role metadata', async () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === ROLES_KEY ? ['super_admin'] : undefined,
      ),
    };
    const permissions = {
      permissionsFor: jest.fn((role: string) =>
        Promise.resolve(role === 'super_admin' ? ['*'] : ['cases.read']),
      ),
    };
    const guard = new RbacGuard(reflector as never, permissions as never);
    await expect(
      guard.canActivate(context({ vfIdentity: identity })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(
        context({ vfIdentity: { ...identity, role: 'super_admin' } }),
      ),
    ).resolves.toBe(true);
    await expect(guard.canActivate(context({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('enforces organization and case-bound client isolation', async () => {
    const organization = new OrganizationGuard();
    expect(() =>
      organization.canActivate(
        context({ vfIdentity: identity, params: { organizationId: 'org-b' } }),
      ),
    ).toThrow(NotFoundException);

    const query = jest.fn().mockResolvedValue([{ allowed: true }]);
    const client = new ClientGuard({ query } as never);
    await expect(
      client.canActivate(
        context({
          vfIdentity: { ...identity, role: 'client', caseId: 'case-a' },
          params: { caseId: 'case-b' },
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects unexpected input through the global validation policy', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const metadata: ArgumentMetadata = {
      type: 'body',
      metatype: ClientLoginDto,
      data: undefined,
    };
    await expect(
      pipe.transform(
        {
          referenceId: 'VF-2026-0001',
          email: 'client@example.test',
          pin: '123456',
          injectedRole: 'super_admin',
        },
        metadata,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('classifies scaffold compatibility routes conservatively', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AuthController)).toEqual([
      'super_admin',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, IntegrationsController)).toEqual([
      'super_admin',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, CommunicationsController)).toEqual([
      'admin',
      'super_admin',
      'investigator',
      'staff',
    ]);
    expect(IS_PUBLIC_KEY).toBe('vineford:is_public');
  });
});
