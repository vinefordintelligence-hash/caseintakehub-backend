import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { VerifiedIdentity } from '../../identity/supabase-identity.service';

@Injectable()
export class ClientGuard implements CanActivate {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>() as Request & {
      vfIdentity?: VerifiedIdentity;
    };
    const identity = request.vfIdentity;
    if (!identity) throw new UnauthorizedException('authentication required');
    const caseId = request.params?.caseId;
    if (!caseId) return true;
    if (identity.role === 'client' && identity.caseId !== caseId)
      throw new NotFoundException('case not found');
    const rows = await this.dataSource.query<Array<{ allowed: boolean }>>(
      `SELECT EXISTS (
         SELECT 1 FROM public.cases c
          WHERE c.id = $1 AND c.organization_id = $2
       ) AS allowed`,
      [caseId, identity.organizationId],
    );
    if (!rows[0]?.allowed) throw new NotFoundException('case not found');
    return true;
  }
}
