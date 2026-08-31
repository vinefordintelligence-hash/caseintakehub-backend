import { Test, TestingModule } from '@nestjs/testing';
import { TimelineController } from './timeline.controller';
import { TimelineService } from './timeline.service';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { SupabaseIdentityService } from '../identity/supabase-identity.service';

describe('TimelineController', () => {
  let controller: TimelineController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TimelineController],
      providers: [
        { provide: TimelineService, useValue: {} },
        {
          provide: SupabaseIdentityGuard,
          useValue: { canActivate: jest.fn() },
        },
        { provide: SupabaseIdentityService, useValue: { verify: jest.fn() } },
      ],
    }).compile();

    controller = module.get<TimelineController>(TimelineController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
