import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let service: ReportsService;

  beforeEach(() => {
    service = new ReportsService(
      { query: jest.fn() } as any,
      { create: jest.fn() } as any,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('advertises only supported report contracts', () => {
    expect(service.types()).toEqual(
      expect.objectContaining({ persistence: false, formats: ['json', 'csv'] }),
    );
  });
});
