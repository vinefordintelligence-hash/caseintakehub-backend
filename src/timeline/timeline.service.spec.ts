import { Test, TestingModule } from '@nestjs/testing';
import { TimelineService } from './timeline.service';
import { DataSource } from 'typeorm';

describe('TimelineService', () => {
  let service: TimelineService;
  const query = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimelineService,
        { provide: DataSource, useValue: { query } },
      ],
    }).compile();

    service = module.get<TimelineService>(TimelineService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates an organization-scoped client-visible timeline event', async () => {
    query
      .mockResolvedValueOnce([{ id: 'case-1' }])
      .mockResolvedValueOnce([{ id: 'timeline-1', organization_id: 'org-1' }]);
    await expect(
      service.create(
        {
          case_id: 'case-1',
          title: 'Test event',
          is_client_visible: true,
          metadata: { test_only: true },
        },
        {
          actorId: 'actor-1',
          organizationId: 'org-1',
          role: 'admin',
          supabaseUserId: 'supabase-1',
        },
      ),
    ).resolves.toMatchObject({ id: 'timeline-1' });
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('organization_id=$2'),
      ['case-1', 'org-1'],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO public.timeline'),
      expect.arrayContaining(['case-1', 'org-1', 'actor-1', true]),
    );
  });
});
