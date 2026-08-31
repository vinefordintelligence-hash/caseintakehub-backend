import { InvestigationsService } from './investigations.service';

describe('InvestigationsService', () => {
  let service: InvestigationsService;

  beforeEach(() => {
    service = new InvestigationsService({ query: jest.fn() } as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('scopes entities and relationships to verified organization and case', async () => {
    const data = { query: jest.fn().mockResolvedValue([]) } as any;
    const scoped = new InvestigationsService(data);
    await scoped.entities('case-a', { organizationId: 'org-a' } as any);
    await scoped.relationships('case-a', { organizationId: 'org-a' } as any);
    expect(data.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('case_id=$1 AND organization_id=$2'),
      ['case-a', 'org-a'],
    );
    expect(data.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('r.case_id=$1 AND r.organization_id=$2'),
      ['case-a', 'org-a'],
    );
  });
});
