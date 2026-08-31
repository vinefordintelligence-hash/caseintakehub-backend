import { TasksService } from './tasks.service';

describe('TasksService', () => {
  let service: TasksService;

  beforeEach(() => {
    service = new TasksService({
      query: jest.fn(),
      transaction: jest.fn(),
    } as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('binds client task reads to verified organization and case', async () => {
    const data = { query: jest.fn().mockResolvedValue([]) } as any;
    const scoped = new TasksService(data);
    await expect(
      scoped.findOne('task-id', {
        organizationId: 'org-a',
        caseId: 'case-a',
        role: 'client',
      } as any),
    ).rejects.toBeDefined();
    expect(data.query).toHaveBeenCalledWith(
      expect.stringContaining('case_id=$3 AND client_visible=true'),
      ['task-id', 'org-a', 'case-a'],
    );
  });
});
