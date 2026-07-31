import { Injectable } from '@nestjs/common';
import { CreateNotificationCenterDto } from './dto/create-notification-center.dto';
import { UpdateNotificationCenterDto } from './dto/update-notification-center.dto';

@Injectable()
export class NotificationCenterService {
  create(createNotificationCenterDto: CreateNotificationCenterDto) {
    return 'This action adds a new notificationCenter';
  }

  findAll() {
    return `This action returns all notificationCenter`;
  }

  findOne(id: number) {
    return `This action returns a #${id} notificationCenter`;
  }

  update(id: number, updateNotificationCenterDto: UpdateNotificationCenterDto) {
    return `This action updates a #${id} notificationCenter`;
  }

  remove(id: number) {
    return `This action removes a #${id} notificationCenter`;
  }
}
