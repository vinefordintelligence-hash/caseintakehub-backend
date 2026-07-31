import { Test, TestingModule } from '@nestjs/testing';
import { NotificationCenterService } from './notification-center.service';

describe('NotificationCenterService', () => {
  let service: NotificationCenterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationCenterService],
    }).compile();

    service = module.get<NotificationCenterService>(NotificationCenterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
