import { PartialType } from '@nestjs/swagger';
import { CreateNotificationCenterDto } from './create-notification-center.dto';

export class UpdateNotificationCenterDto extends PartialType(
  CreateNotificationCenterDto,
) {}
