import { Module } from '@nestjs/common';
import { TreasuryService } from './treasury.service';
import { TreasuryController } from './treasury.controller';
import { IdentityModule } from '../identity/identity.module';
import { FundingModule } from '../funding/funding.module';
import { DepositAddressProvider } from './deposit-address-provider';

@Module({
  imports: [IdentityModule, FundingModule],
  controllers: [TreasuryController],
  providers: [TreasuryService, DepositAddressProvider],
})
export class TreasuryModule {}
