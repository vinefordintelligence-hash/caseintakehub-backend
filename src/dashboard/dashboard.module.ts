import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { CommonModule } from '../common/common.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [CommonModule, IdentityModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
