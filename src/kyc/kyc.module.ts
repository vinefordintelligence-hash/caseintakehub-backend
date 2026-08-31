import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
@Module({
  imports: [IdentityModule],
  controllers: [KycController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
