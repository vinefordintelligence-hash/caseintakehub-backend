import { Test, TestingModule } from '@nestjs/testing';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { SupabaseIdentityService } from '../identity/supabase-identity.service';

describe('CasesController', () => {
  let controller: CasesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CasesController],
      providers: [
        {
          provide: SupabaseIdentityGuard,
          useValue: { canActivate: jest.fn() },
        },
        { provide: SupabaseIdentityService, useValue: { verify: jest.fn() } },
        {
          provide: CasesService,
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

    controller = module.get<CasesController>(CasesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
