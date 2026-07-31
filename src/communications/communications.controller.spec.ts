import { Test, TestingModule } from '@nestjs/testing';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';

describe('CommunicationsController', () => {
  let controller: CommunicationsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommunicationsController],
      providers: [CommunicationsService],
    }).compile();

    controller = module.get<CommunicationsController>(CommunicationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
