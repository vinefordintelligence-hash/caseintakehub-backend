import { Test, TestingModule } from '@nestjs/testing';
import { DocumentsService } from './documents.service';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PermissionsService } from '../permissions/permissions.service';

describe('DocumentsService', () => {
  let service: DocumentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: getDataSourceToken(), useValue: { query: jest.fn() } },
        { provide: PermissionsService, useValue: { require: jest.fn() } },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
