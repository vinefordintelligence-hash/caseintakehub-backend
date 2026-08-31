import { Test, TestingModule } from '@nestjs/testing';
import { EvidenceService } from './evidence.service';
import { getDataSourceToken } from '@nestjs/typeorm';

describe('EvidenceService', () => {
  let service: EvidenceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceService,
        { provide: getDataSourceToken(), useValue: { query: jest.fn() } },
      ],
    }).compile();

    service = module.get<EvidenceService>(EvidenceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
