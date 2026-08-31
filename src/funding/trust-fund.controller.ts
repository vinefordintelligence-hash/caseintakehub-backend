import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { FeaturePolicyService } from './feature-policy.service';
import { FundingFeatureGuard, RequireFeatures } from './funding-feature.guard';

/** Authorization boundary for the upcoming TrustFund workspace. */
@Controller('trust-fund')
@UseGuards(SupabaseIdentityGuard, FundingFeatureGuard)
export class TrustFundController {
  constructor(private readonly policy: FeaturePolicyService) {}

  @Get('access')
  @RequireFeatures('fundingEnabled', 'trustFundEnabled')
  async access(@Req() req: Request) {
    const identity = (req as Request & { vfIdentity?: VerifiedIdentity })
      .vfIdentity!;
    const state = await this.policy.state(identity);
    return {
      enabled: true,
      organizationId: identity.organizationId,
      features: state.effective,
    };
  }
}
