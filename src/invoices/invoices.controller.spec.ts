import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

describe('InvoicesController', () => {
  let controller: InvoicesController;

  beforeEach(() => {
    controller = new InvoicesController({} as InvoicesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
