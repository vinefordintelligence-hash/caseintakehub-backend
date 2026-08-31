import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { IdentityModule } from '../identity/identity.module';
import { FundingModule } from '../funding/funding.module';
import { EnterpriseController } from './enterprise.controller';
import { EnterpriseService } from './enterprise.service';

@Module({
  imports: [CommonModule, IdentityModule, FundingModule],
  controllers: [EnterpriseController],
  providers: [EnterpriseService],
})
export class EnterpriseModule {}
