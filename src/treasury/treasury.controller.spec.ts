import { Test, TestingModule } from '@nestjs/testing';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';

describe('TreasuryController', () => {
  let controller: TreasuryController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TreasuryController],
      providers: [TreasuryService],
    }).compile();

    controller = module.get<TreasuryController>(TreasuryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
