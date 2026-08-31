import { Module } from '@nestjs/common';
import { FundingService } from './funding.service';
import { FundingController } from './funding.controller';
import { IdentityModule } from '../identity/identity.module';
import { AlgorandService } from './algorand.service';
import { FundingFeatureGuard } from './funding-feature.guard';
import { FeaturePolicyService } from './feature-policy.service';
import { TrustFundController } from './trust-fund.controller';

@Module({
  imports: [IdentityModule],
  controllers: [FundingController, TrustFundController],
  providers: [
    FundingService,
    AlgorandService,
    FeaturePolicyService,
    FundingFeatureGuard,
  ],
  exports: [FeaturePolicyService, FundingFeatureGuard, AlgorandService],
})
export class FundingModule {}
