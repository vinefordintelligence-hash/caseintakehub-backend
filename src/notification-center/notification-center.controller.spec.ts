import { Test, TestingModule } from '@nestjs/testing';
import { NotificationCenterController } from './notification-center.controller';
import { NotificationCenterService } from './notification-center.service';

describe('NotificationCenterController', () => {
  let controller: NotificationCenterController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationCenterController],
      providers: [NotificationCenterService],
    }).compile();

    controller = module.get<NotificationCenterController>(NotificationCenterController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
