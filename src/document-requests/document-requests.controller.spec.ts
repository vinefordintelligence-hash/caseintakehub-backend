import { Test, TestingModule } from '@nestjs/testing';
import { DocumentRequestsController } from './document-requests.controller';
import { DocumentRequestsService } from './document-requests.service';

describe('DocumentRequestsController', () => {
  let controller: DocumentRequestsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentRequestsController],
      providers: [DocumentRequestsService],
    }).compile();

    controller = module.get<DocumentRequestsController>(DocumentRequestsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
