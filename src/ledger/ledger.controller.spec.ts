import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

describe('LedgerController', () => {
  let controller: LedgerController;

  beforeEach(() => {
    controller = new LedgerController({} as LedgerService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
