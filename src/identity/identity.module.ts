import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SupabaseIdentityGuard } from './supabase-identity.guard';
import { SupabaseIdentityService } from './supabase-identity.service';
import { IdentityLinkBootstrapService } from './identity-link-bootstrap.service';
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  providers: [
    SupabaseIdentityService,
    SupabaseIdentityGuard,
    IdentityLinkBootstrapService,
  ],
  exports: [SupabaseIdentityGuard, SupabaseIdentityService],
})
export class IdentityModule {}
