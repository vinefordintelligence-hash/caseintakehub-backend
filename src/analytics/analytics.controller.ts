import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Permissions } from '../core/decorators/permissions.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@Roles('admin', 'super_admin', 'investigator', 'financial_analyst', 'staff')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  @Permissions('reports.read')
  overview(@CurrentUser() identity: VerifiedIdentity) {
    return this.analyticsService.overview(identity);
  }

  @Post() @Permissions('reports.generate') create() {
    return this.analyticsService.create();
  }
  @Get(':id') @Permissions('reports.read') findOne() {
    return this.analyticsService.findOne();
  }
  @Patch(':id') @Permissions('reports.generate') update() {
    return this.analyticsService.update();
  }
  @Delete(':id') @Permissions('reports.generate') remove() {
    return this.analyticsService.remove();
  }
}
