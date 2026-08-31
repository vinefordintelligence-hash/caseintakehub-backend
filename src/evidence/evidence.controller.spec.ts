import { Test, TestingModule } from '@nestjs/testing';
import { EvidenceController } from './evidence.controller';
import { EvidenceService } from './evidence.service';
import { SupabaseIdentityService } from '../identity/supabase-identity.service';

describe('EvidenceController', () => {
  let controller: EvidenceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EvidenceController],
      providers: [
        { provide: SupabaseIdentityService, useValue: { verify: jest.fn() } },
        {
          provide: EvidenceService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<EvidenceController>(EvidenceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
