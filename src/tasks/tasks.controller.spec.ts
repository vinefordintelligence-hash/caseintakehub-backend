import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

describe('TasksController', () => {
  let controller: TasksController;

  beforeEach(() => {
    controller = new TasksController({} as TasksService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
