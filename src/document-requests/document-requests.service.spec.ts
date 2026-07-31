import { Test, TestingModule } from '@nestjs/testing';
import { DocumentRequestsService } from './document-requests.service';

describe('DocumentRequestsService', () => {
  let service: DocumentRequestsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DocumentRequestsService],
    }).compile();

    service = module.get<DocumentRequestsService>(DocumentRequestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
