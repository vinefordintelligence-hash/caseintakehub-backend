import { ForbiddenException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  it('uses only the verified organization in every aggregate', async () => {
    const data = { query: jest.fn().mockResolvedValue([{ value: [] }]) } as any;
    const service = new AnalyticsService(data);
    await service.overview({
      actorId: 'actor',
      organizationId: 'org',
      role: 'admin',
    } as any);
    expect(data.query).toHaveBeenCalledTimes(4);
    for (const call of data.query.mock.calls) expect(call[1]).toEqual(['org']);
  });

  it('rejects client analytics access', async () => {
    const service = new AnalyticsService({ query: jest.fn() } as any);
    await expect(
      service.overview({ organizationId: 'org', role: 'client' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
