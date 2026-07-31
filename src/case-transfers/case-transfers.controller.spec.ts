import { Test, TestingModule } from '@nestjs/testing';
import { CaseTransfersController } from './case-transfers.controller';
import { CaseTransfersService } from './case-transfers.service';

describe('CaseTransfersController', () => {
  let controller: CaseTransfersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CaseTransfersController],
      providers: [CaseTransfersService],
    }).compile();

    controller = module.get<CaseTransfersController>(CaseTransfersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
