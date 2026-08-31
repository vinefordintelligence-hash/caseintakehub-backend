import { Test, TestingModule } from '@nestjs/testing';
import { DocumentRequestsController } from './document-requests.controller';
import { DocumentRequestsService } from './document-requests.service';
import { SupabaseIdentityService } from '../identity/supabase-identity.service';

describe('DocumentRequestsController', () => {
  let controller: DocumentRequestsController;
  let serviceMock: {
    findAll: jest.Mock;
    create: jest.Mock;
    submit: jest.Mock;
    review: jest.Mock;
  };

  beforeEach(async () => {
    serviceMock = {
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'req-1' }),
      submit: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      review: jest.fn().mockResolvedValue({ id: 'req-1', status: 'approved' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentRequestsController],
      providers: [
        { provide: SupabaseIdentityService, useValue: { verify: jest.fn() } },
        { provide: DocumentRequestsService, useValue: serviceMock },
      ],
    }).compile();
    controller = module.get<DocumentRequestsController>(
      DocumentRequestsController,
    );
  });

  it('lists requests passing case context and actor id', async () => {
    await controller.findAll('case-1', undefined, 'client', 'actor-1');
    expect(serviceMock.findAll).toHaveBeenCalledWith(
      'actor-1',
      'case-1',
      'client',
    );
  });

  it('creates a request through the service', async () => {
    await controller.create(
      { caseId: 'case-1', title: 'Bank Statement', deadline: '2026-09-01' },
      'actor-1',
    );
    expect(serviceMock.create).toHaveBeenCalledWith('actor-1', {
      caseId: 'case-1',
      title: 'Bank Statement',
      description: null,
      deadline: '2026-09-01',
      isClientVisible: true,
    });
  });

  it('submits a document upload through the service', async () => {
    await controller.submit(
      'req-1',
      {
        file_name: 'statement.pdf',
        file_size: 1024,
        file_type: 'application/pdf',
      },
      'actor-1',
    );
    expect(serviceMock.submit).toHaveBeenCalledWith('actor-1', 'req-1', {
      title: null,
      file_name: 'statement.pdf',
      file_size: 1024,
      file_type: 'application/pdf',
    });
  });

  it('reviews a request through the service', async () => {
    await controller.review(
      'req-1',
      { status: 'approved', note: 'ok' },
      'actor-1',
    );
    expect(serviceMock.review).toHaveBeenCalledWith('actor-1', 'req-1', {
      status: 'approved',
      note: 'ok',
    });
  });
});
