import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { VerifiedIdentity } from '../../identity/supabase-identity.service';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): VerifiedIdentity | undefined =>
    (
      context.switchToHttp().getRequest<Request>() as Request & {
        vfIdentity?: VerifiedIdentity;
      }
    ).vfIdentity,
);
