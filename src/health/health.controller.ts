import { Controller, Get } from '@nestjs/common';
import { Public } from '../core/decorators/public.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}
  @Get('live') @Public() live() {
    return this.health.live();
  }
  @Get('ready') @Public() ready() {
    return this.health.ready();
  }
  @Get('dependencies') @Roles('super_admin') dependencies() {
    return this.health.dependencies();
  }
}
