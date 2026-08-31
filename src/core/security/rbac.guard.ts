import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { VerifiedIdentity } from '../../identity/supabase-identity.service';
import { PermissionsService } from '../../permissions/permissions.service';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const permissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length && !permissions?.length) return true;

    const request = context.switchToHttp().getRequest<Request>() as Request & {
      vfIdentity?: VerifiedIdentity;
    };
    const identity = request.vfIdentity;
    if (!identity) throw new UnauthorizedException('authentication required');
    if (roles?.length && !roles.includes(identity.role))
      throw new ForbiddenException('insufficient role');

    const granted = await this.permissionService.permissionsFor(identity.role);
    if (
      permissions?.some(
        (permission) => !granted.includes('*') && !granted.includes(permission),
      )
    )
      throw new ForbiddenException('insufficient permission');
    return true;
  }
}
