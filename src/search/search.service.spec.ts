import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SearchService } from './search.service';

describe('SearchService', () => {
  const identity = {
    actorId: 'actor',
    organizationId: 'org',
    role: 'investigator',
  } as any;

  it('scopes search queries to the verified organization', async () => {
    const data = { query: jest.fn().mockResolvedValue([]) } as any;
    const service = new SearchService(data);
    await service.search({ q: 'needle', type: 'all', limit: 20 }, identity);
    expect(data.query).toHaveBeenCalledWith(
      expect.stringContaining('organization_id=$1'),
      ['org', '%needle%', 'all', 20],
    );
  });

  it('rejects clients and missing lookup results', async () => {
    const data = { query: jest.fn().mockResolvedValue([]) } as any;
    const service = new SearchService(data);
    await expect(
      service.search(
        { q: 'case', type: 'all', limit: 30 },
        { ...identity, role: 'client' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.lookup('VF-2026-1', identity)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
