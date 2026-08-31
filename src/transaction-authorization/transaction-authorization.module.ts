import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { TransactionAuthorizationController } from './transaction-authorization.controller';
import { TransactionAuthorizationService } from './transaction-authorization.service';
@Module({
  imports: [IdentityModule],
  controllers: [TransactionAuthorizationController],
  providers: [TransactionAuthorizationService],
})
export class TransactionAuthorizationModule {}
