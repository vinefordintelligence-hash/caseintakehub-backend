import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DocumentRequestsService } from './document-requests.service';
import { ActorService } from '../common/actor.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationCenterService } from '../notification-center/notification-center.service';

const adminActor = {
  id: 'a0000000-0000-4000-8000-000000000001',
  role: 'admin',
  organization_id: 'org-1',
  name: 'Admin',
  email: 'admin@vineford.com',
};

const clientActor = {
  id: 'a0000000-0000-4000-8000-000000000002',
  role: 'client',
  organization_id: 'org-1',
  name: 'Gayl M. Chenoweth',
  email: 'gayl302726@yahoo.com',
};

describe('DocumentRequestsService', () => {
  let service: DocumentRequestsService;
  let mockDataSource: { query: jest.Mock };
  let actorMock: { requireAdmin: jest.Mock; find: jest.Mock };
  let auditMock: { create: jest.Mock };
  let notifyMock: { create: jest.Mock };

  beforeEach(async () => {
    mockDataSource = { query: jest.fn() };
    actorMock = {
      requireAdmin: jest.fn().mockResolvedValue(adminActor),
      find: jest.fn().mockResolvedValue(clientActor),
    };
    auditMock = { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    notifyMock = { create: jest.fn().mockResolvedValue({ id: 'n-1' }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentRequestsService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: ActorService, useValue: actorMock },
        { provide: AuditLogsService, useValue: auditMock },
        { provide: NotificationCenterService, useValue: notifyMock },
      ],
    }).compile();
    service = module.get<DocumentRequestsService>(DocumentRequestsService);
  });

  it('creates a request, notifies the client and audits the action', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      { id: 'req-1', title: 'Bank Statement' },
    ]);

    const result = await service.create(
      'a0000000-0000-4000-8000-000000000001',
      {
        caseId: 'case-1',
        title: 'Bank Statement',
        deadline: '2026-09-01',
      },
    );

    expect(result.id).toBe('req-1');
    expect(notifyMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ recipientRole: 'client' }),
    );
    expect(auditMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document_request.created' }),
    );
  });

  it('lists requests for an authorized client scoped to its case', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([{ allowed: true }])
      .mockResolvedValueOnce([{ id: 'req-1', title: 'Bank Statement' }]);

    const items = await service.findAll(
      'a0000000-0000-4000-8000-000000000002',
      'case-1',
      'client',
    );

    expect(items[0].title).toBe('Bank Statement');
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('dr.is_client_visible = true'),
      ['case-1'],
    );
  });

  it('denies a client that is not authorized for the case', async () => {
    mockDataSource.query.mockResolvedValueOnce([{ allowed: false }]);

    await expect(
      service.findAll(
        'a0000000-0000-4000-8000-000000000002',
        'case-2',
        'client',
      ),
    ).rejects.toThrow(/not authorized for case/);
  });

  it('submits a document and transitions the request to submitted', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([
        {
          id: 'req-1',
          case_id: 'case-1',
          organization_id: 'org-1',
          status: 'open',
        },
      ])
      .mockResolvedValueOnce([{ allowed: true }])
      .mockResolvedValueOnce([{ id: 'doc-1', file_name: 'statement.pdf' }])
      .mockResolvedValueOnce([]);

    const result = await service.submit(
      'a0000000-0000-4000-8000-000000000002',
      'req-1',
      {
        file_name: 'statement.pdf',
        file_size: 1024,
      },
    );

    expect(result.file_name).toBe('statement.pdf');
    const updateSql = String(mockDataSource.query.mock.calls[3][0]);
    expect(updateSql).toContain("SET status = 'submitted'");
    expect(notifyMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ recipientRole: 'admin' }),
    );
  });

  it('reviews a submission as approved and notifies the client', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([
        {
          id: 'req-1',
          case_id: 'case-1',
          organization_id: 'org-1',
          title: 'Bank Statement',
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.review(
      'a0000000-0000-4000-8000-000000000001',
      'req-1',
      {
        status: 'approved',
        note: 'Looks good',
      },
    );

    expect(result.status).toBe('approved');
    expect(notifyMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Document approved' }),
    );
    expect(auditMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document_request.approved' }),
    );
  });
});
