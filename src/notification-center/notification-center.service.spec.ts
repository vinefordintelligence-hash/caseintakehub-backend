import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { NotificationCenterService } from './notification-center.service';
import { ActorService } from '../common/actor.service';

const clientActor = {
  id: 'a0000000-0000-4000-8000-000000000002',
  role: 'client',
  organization_id: 'org-1',
  name: 'Gayl M. Chenoweth',
  email: 'gayl302726@yahoo.com',
};

const adminActor = {
  id: 'a0000000-0000-4000-8000-000000000001',
  role: 'admin',
  organization_id: 'org-1',
  name: 'Admin',
  email: 'admin@vineford.com',
};

describe('NotificationCenterService', () => {
  let service: NotificationCenterService;
  let mockDataSource: { query: jest.Mock };
  let actorMock: { find: jest.Mock };

  beforeEach(async () => {
    mockDataSource = { query: jest.fn() };
    actorMock = { find: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationCenterService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: ActorService, useValue: actorMock },
      ],
    }).compile();
    service = module.get<NotificationCenterService>(NotificationCenterService);
  });

  it('creates a notification', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      { id: 'n-1', recipient_role: 'client', title: 'Document requested' },
    ]);
    const result = await service.create({
      caseId: 'case-1',
      organizationId: 'org-1',
      recipientRole: 'client',
      title: 'Document requested',
    });
    expect(result.id).toBe('n-1');
    expect(String(mockDataSource.query.mock.calls[0][0])).toContain(
      'INSERT INTO public.case_notifications',
    );
  });

  it('lists client notifications only for an authorized case', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([{ allowed: true }])
      .mockResolvedValueOnce([{ id: 'n-1', title: 'Document requested' }]);

    const items = await service.list(clientActor, 'case-1');
    expect(items[0].title).toBe('Document requested');
    expect(String(mockDataSource.query.mock.calls[1][0])).toContain(
      "recipient_role = 'client' AND case_id = $1",
    );
  });

  it('refuses client notifications without case context', async () => {
    const items = await service.list(clientActor, undefined);
    expect(items).toEqual([]);
  });

  it('lists admin notifications organization-wide', async () => {
    mockDataSource.query.mockResolvedValueOnce([{ id: 'n-1' }]);
    const items = await service.list(adminActor, undefined);
    expect(items[0].id).toBe('n-1');
    expect(String(mockDataSource.query.mock.calls[0][0])).toContain(
      "n.recipient_role = 'admin'",
    );
  });

  it('marks a notification read for the client within its case', async () => {
    mockDataSource.query.mockResolvedValueOnce([]);
    await service.markRead('n-1', clientActor, 'case-1');
    const [sql, params] = mockDataSource.query.mock.calls[0];
    expect(String(sql)).toContain("recipient_role = 'client' AND case_id = $2");
    expect(params).toEqual(['n-1', 'case-1']);
  });

  it('marks all notifications read for an organization admin', async () => {
    mockDataSource.query.mockResolvedValueOnce([]);
    await service.markAllRead(adminActor, undefined);
    const [sql, params] = mockDataSource.query.mock.calls[0];
    expect(String(sql)).toContain(
      "recipient_role = 'admin' AND organization_id = $1",
    );
    expect(params).toEqual(['org-1']);
  });
});
