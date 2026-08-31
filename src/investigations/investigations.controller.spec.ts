import { InvestigationsController } from './investigations.controller';
import { InvestigationsService } from './investigations.service';

describe('InvestigationsController', () => {
  let controller: InvestigationsController;

  beforeEach(() => {
    controller = new InvestigationsController({} as InvestigationsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
