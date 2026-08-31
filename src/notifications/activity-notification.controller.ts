import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { ActivityNotificationService } from './activity-notification.service';

@Controller('activity-notifications')
export class ActivityNotificationController {
  constructor(private readonly notifications: ActivityNotificationService) {}
  @Get('settings') settings(@CurrentUser() identity: VerifiedIdentity) {
    return this.notifications.getSettings(identity);
  }
  @Patch('settings') update(
    @Body() body: Record<string, unknown>,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.notifications.updateSettings(body, identity);
  }
}
