import { Test, TestingModule } from '@nestjs/testing';
import { CaseTransfersService } from './case-transfers.service';

describe('CaseTransfersService', () => {
  let service: CaseTransfersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CaseTransfersService],
    }).compile();

    service = module.get<CaseTransfersService>(CaseTransfersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
