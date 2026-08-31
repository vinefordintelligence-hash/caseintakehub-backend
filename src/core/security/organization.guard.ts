import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { VerifiedIdentity } from '../../identity/supabase-identity.service';

@Injectable()
export class OrganizationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>() as Request & {
      vfIdentity?: VerifiedIdentity;
    };
    if (!request.vfIdentity)
      throw new UnauthorizedException('authentication required');
    const requested = request.params?.organizationId;
    if (requested && requested !== request.vfIdentity.organizationId)
      throw new NotFoundException('organization not found');
    return true;
  }
}
