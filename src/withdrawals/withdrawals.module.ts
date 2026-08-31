import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalsController } from './withdrawals.controller';
import { CaseMessagesController } from './case-messages.controller';
import { CaseWithdrawalRequest } from './entities/case-withdrawal-request.entity';
import { CaseMessage } from './entities/case-message.entity';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CaseWithdrawalRequest, CaseMessage]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { algorithm: 'HS256' },
      }),
    }),
    IdentityModule,
  ],
  controllers: [WithdrawalsController, CaseMessagesController],
  providers: [WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
