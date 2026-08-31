import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../core/decorators/public.decorator';
import { SupabaseIdentityService } from './supabase-identity.service';
@Injectable()
export class SupabaseIdentityGuard implements CanActivate {
  constructor(
    private readonly identities: SupabaseIdentityService,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const verifiedRequest = request as Request & {
      vfIdentity?: Awaited<ReturnType<SupabaseIdentityService['verify']>>;
    };
    if (verifiedRequest.vfIdentity) return true;

    const identity = await this.identities.verify(
      typeof request.headers.authorization === 'string'
        ? request.headers.authorization
        : undefined,
      typeof request.headers['x-actor-id'] === 'string'
        ? request.headers['x-actor-id']
        : undefined,
      typeof request.headers['x-organization-id'] === 'string'
        ? request.headers['x-organization-id']
        : undefined,
    );
    request.headers['x-actor-id'] = identity.actorId;
    request.headers['x-organization-id'] = identity.organizationId;
    verifiedRequest.vfIdentity = identity;
    return true;
  }
}
