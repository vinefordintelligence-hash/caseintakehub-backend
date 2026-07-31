import { Test, TestingModule } from '@nestjs/testing';
import { InvestigationsService } from './investigations.service';

describe('InvestigationsService', () => {
  let service: InvestigationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InvestigationsService],
    }).compile();

    service = module.get<InvestigationsService>(InvestigationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
