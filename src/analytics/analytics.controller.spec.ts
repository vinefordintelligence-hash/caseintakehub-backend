import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;

  beforeEach(() => {
    controller = new AnalyticsController({} as AnalyticsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
