import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { NotificationCenterService } from './notification-center.service';
import { CreateNotificationCenterDto } from './dto/create-notification-center.dto';
import { UpdateNotificationCenterDto } from './dto/update-notification-center.dto';

@Controller('notification-center')
export class NotificationCenterController {
  constructor(private readonly notificationCenterService: NotificationCenterService) {}

  @Post()
  create(@Body() createNotificationCenterDto: CreateNotificationCenterDto) {
    return this.notificationCenterService.create(createNotificationCenterDto);
  }

  @Get()
  findAll() {
    return this.notificationCenterService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.notificationCenterService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateNotificationCenterDto: UpdateNotificationCenterDto) {
    return this.notificationCenterService.update(+id, updateNotificationCenterDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.notificationCenterService.remove(+id);
  }
}
