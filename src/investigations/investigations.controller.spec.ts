import { Test, TestingModule } from '@nestjs/testing';
import { InvestigationsController } from './investigations.controller';
import { InvestigationsService } from './investigations.service';

describe('InvestigationsController', () => {
  let controller: InvestigationsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvestigationsController],
      providers: [InvestigationsService],
    }).compile();

    controller = module.get<InvestigationsController>(InvestigationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
