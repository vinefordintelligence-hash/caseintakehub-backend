import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ClientAuthController } from './client-auth.controller';
import { ClientAuthService } from './client-auth.service';
import { IdentityModule } from '../identity/identity.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { algorithm: 'HS256' },
      }),
    }),
    IdentityModule,
    AuditLogsModule,
    NotificationsModule,
  ],
  controllers: [ClientAuthController],
  providers: [ClientAuthService],
  exports: [ClientAuthService],
})
export class ClientAuthModule {}
