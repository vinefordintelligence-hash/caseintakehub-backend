import { LedgerService } from './ledger.service';

describe('LedgerService', () => {
  let service: LedgerService;

  beforeEach(() => {
    service = new LedgerService({ query: jest.fn() } as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
