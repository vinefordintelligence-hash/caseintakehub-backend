import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { FeatureName, FeaturePolicyService } from './feature-policy.service';

export const FEATURE_POLICY = 'vineford.feature_policy';
export const RequireFeatures = (...features: FeatureName[]) =>
  SetMetadata(FEATURE_POLICY, features);

@Injectable()
export class FundingFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policy: FeaturePolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { vfIdentity?: VerifiedIdentity }>();
    const identity = request.vfIdentity;
    if (!identity) throw new ForbiddenException('verified identity required');
    const required =
      this.reflector.getAllAndOverride<FeatureName[]>(FEATURE_POLICY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length) await this.policy.require(identity, required);
    return true;
  }
}
