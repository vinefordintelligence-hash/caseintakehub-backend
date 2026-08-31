import { InvoicesService } from './invoices.service';

describe('InvoicesService', () => {
  let service: InvoicesService;

  beforeEach(() => {
    service = new InvoicesService({
      query: jest.fn(),
      transaction: jest.fn(),
    } as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
