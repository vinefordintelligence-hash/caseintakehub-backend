import { SearchController } from './search.controller';
import { SearchService } from './search.service';

describe('SearchController', () => {
  let controller: SearchController;

  beforeEach(() => {
    controller = new SearchController({} as SearchService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
