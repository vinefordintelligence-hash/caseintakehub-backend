import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationCenterService } from './notification-center.service';
import { ActorService } from '../common/actor.service';
import { CreateNotificationDto } from './dto/create-notification.dto';

@ApiTags('notification-center')
@Controller('notification-center')
@UseGuards(SupabaseIdentityGuard)
export class NotificationCenterController {
  constructor(
    private readonly notificationCenterService: NotificationCenterService,
    private readonly actorService: ActorService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List notifications for the caller — client role requires a case context; admin role is organization-scoped',
  })
  async list(
    @Query('case_id') caseId?: string,
    @Query('caseId') caseIdAlt?: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    const actor = await this.actorService.find(actorId);
    if (!actor) {
      return { items: [], unread: 0 };
    }
    const caseContext = caseId ?? caseIdAlt;
    const [items, unread] = await Promise.all([
      this.notificationCenterService.list(actor, caseContext),
      this.notificationCenterService.unreadCount(actor, caseContext),
    ]);
    return { items, unread };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('case_id') caseId?: string,
    @Query('caseId') caseIdAlt?: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    const caseContext = caseId ?? caseIdAlt;
    return this.actorService.find(actorId).then((actor) => {
      if (!actor) {
        return { ok: false };
      }
      return this.notificationCenterService.markRead(id, actor, caseContext);
    });
  }

  @Patch('read-all')
  @ApiOperation({
    summary: 'Mark all notifications as read (client: per case)',
  })
  markAllRead(
    @Query('case_id') caseId?: string,
    @Query('caseId') caseIdAlt?: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    const caseContext = caseId ?? caseIdAlt;
    return this.actorService.find(actorId).then((actor) => {
      if (!actor) {
        return { ok: false };
      }
      return this.notificationCenterService.markAllRead(actor, caseContext);
    });
  }

  @Post()
  @ApiOperation({
    summary: 'Create a notification (administrators only)',
  })
  create(
    @Body() dto: CreateNotificationDto,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.actorService.requireAdmin(actorId).then((actor) =>
      this.notificationCenterService.create({
        caseId: dto.case_id,
        organizationId: actor.organization_id,
        recipientRole: dto.recipient_role === 'admin' ? 'admin' : 'client',
        title: dto.title,
        body: dto.body ?? '',
      }),
    );
  }
}
