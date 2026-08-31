import { CustodyService } from './custody.service';
describe('CustodyService', () => {
  it('lists custody only in the verified organization', async () => {
    const data = { query: jest.fn().mockResolvedValue([]) } as any;
    await new CustodyService(data).list('evidence', {
      organizationId: 'org',
    } as any);
    expect(data.query).toHaveBeenCalledWith(
      expect.stringContaining('ce.organization_id=$2'),
      ['evidence', 'org'],
    );
  });
});
