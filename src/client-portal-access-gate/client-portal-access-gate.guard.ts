import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { ClientPortalAccessGateService } from './client-portal-access-gate.service';

const LOCK_MESSAGE =
  'Complete the required verification and payment before accessing this section.';

@Injectable()
export class ClientPortalAccessGateGuard implements CanActivate {
  constructor(private readonly gates: ClientPortalAccessGateService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { vfIdentity?: VerifiedIdentity }>();
    const identity = request.vfIdentity;
    if (!identity || identity.role !== 'client' || !identity.caseId)
      return true;
    const gate = await this.gates.state(
      identity.caseId,
      identity.organizationId,
    );
    if (!gate.locked || this.allowedWhileLocked(request)) return true;
    throw new ForbiddenException(LOCK_MESSAGE);
  }

  private allowedWhileLocked(request: Request): boolean {
    const path = request.path.replace(/\/+$/, '');
    if (
      request.method === 'GET' &&
      (/^\/case-progress\/[^/]+$/.test(path) ||
        /^\/workflow\/cases\/[^/]+$/.test(path))
    )
      return true;
    return /^\/transaction-authorization\/cases\/[^/]+(?:\/(?:voided-check|payment-receipt)(?:\/review|\/download)?|\/authorization)?$/.test(
      path,
    );
  }
}

export { LOCK_MESSAGE };
