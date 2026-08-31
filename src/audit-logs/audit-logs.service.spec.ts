import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { AuditLogsService } from './audit-logs.service';

describe('AuditLogsService', () => {
  let service: AuditLogsService;
  let mockDataSource: { query: jest.Mock };

  beforeEach(async () => {
    mockDataSource = { query: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogsService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();
    service = module.get<AuditLogsService>(AuditLogsService);
  });

  it('writes an audit entry with case scoping and changes JSON', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      { id: 'a1', action: 'case.view.admin' },
    ]);

    const result = await service.create({
      organizationId: 'org-1',
      userId: 'user-1',
      action: 'case.view.admin',
      resourceType: 'case',
      resourceId: 'case-1',
      caseId: 'case-1',
      changes: { view: 'admin' },
    });

    expect(result.id).toBe('a1');
    const [sql, params] = mockDataSource.query.mock.calls[0];
    expect(String(sql)).toContain('INSERT INTO public.audit_logs');
    expect(params[0]).toBe('org-1');
    expect(params[4]).toBe('case-1');
    expect(params[6]).toContain('"view":"admin"');
  });

  it('redacts secret-bearing audit metadata recursively', async () => {
    mockDataSource.query.mockResolvedValueOnce([{ id: 'audit-safe' }]);
    await service.create({
      organizationId: 'org-a',
      userId: 'actor-a',
      action: 'SECURITY_CHANGE',
      resourceType: 'security',
      resourceId: 'resource-a',
      changes: {
        access_token: 'raw-token',
        nested: { pin: '123456', safe: 'retained' },
      },
    });
    const parameters = mockDataSource.query.mock.calls[0][1] as unknown[];
    expect(parameters[6]).toBe(
      JSON.stringify({
        access_token: '[REDACTED]',
        nested: { pin: '[REDACTED]', safe: 'retained' },
      }),
    );
    expect(String(parameters[6])).not.toContain('raw-token');
    expect(String(parameters[6])).not.toContain('123456');
  });

  it('lists audit entries ordered by created_at desc with limit/offset', async () => {
    mockDataSource.query.mockResolvedValueOnce([{ id: 'a1' }]);

    const items = await service.findAll({
      organizationId: 'org-1',
      action: 'workflow.advance',
      limit: 25,
      offset: 10,
    });

    expect(items[0].id).toBe('a1');
    const [sql, params] = mockDataSource.query.mock.calls[0];
    expect(String(sql)).toContain('ORDER BY a.created_at DESC');
    expect(String(sql)).toContain('LIMIT $3 OFFSET $4');
    expect(params).toEqual(['org-1', 'workflow.advance', 25, 10]);
  });

  it('counts matching entries', async () => {
    mockDataSource.query.mockResolvedValueOnce([{ total: 7 }]);
    const total = await service.count({ organizationId: 'org-1' });
    expect(total).toBe(7);
  });

  it('matches historical case audits through case_id or resource_id', async () => {
    mockDataSource.query.mockResolvedValueOnce([{ total: 4 }]);
    await expect(
      service.count({ organizationId: 'org-1', caseId: 'VF-2026-8282' }),
    ).resolves.toBe(4);
    const [sql, params] = mockDataSource.query.mock.calls[0];
    expect(String(sql)).toContain('a.case_id IN');
    expect(String(sql)).toContain('a.resource_id IN');
    expect(params).toEqual(['org-1', 'VF-2026-8282']);
  });
});
