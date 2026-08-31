import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

describe('ReportsController', () => {
  let controller: ReportsController;

  beforeEach(() => {
    controller = new ReportsController({} as ReportsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
