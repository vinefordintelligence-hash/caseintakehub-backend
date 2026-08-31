import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ActorService } from '../common/actor.service';
import { SupabaseIdentityService } from '../identity/supabase-identity.service';

const adminActor = {
  id: 'a0000000-0000-4000-8000-000000000001',
  role: 'admin',
  organization_id: 'org-1',
  name: 'Admin',
  email: 'admin@vineford.com',
};

describe('DashboardController', () => {
  let controller: DashboardController;
  let serviceMock: {
    summary: jest.Mock;
    phaseDistribution: jest.Mock;
    timeInPhase: jest.Mock;
    paymentAging: jest.Mock;
    search: jest.Mock;
  };
  let actorMock: { requireAdmin: jest.Mock };

  beforeEach(async () => {
    serviceMock = {
      summary: jest.fn().mockResolvedValue({ open_cases: 1 }),
      phaseDistribution: jest.fn().mockResolvedValue([]),
      timeInPhase: jest.fn().mockResolvedValue([]),
      paymentAging: jest.fn().mockResolvedValue([]),
      search: jest.fn().mockResolvedValue({ items: [] }),
    };
    actorMock = { requireAdmin: jest.fn().mockResolvedValue(adminActor) };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: DashboardService, useValue: serviceMock },
        { provide: ActorService, useValue: actorMock },
        { provide: SupabaseIdentityService, useValue: { verify: jest.fn() } },
      ],
    }).compile();
    controller = module.get<DashboardController>(DashboardController);
  });

  it('serves the summary only to administrators', async () => {
    const result = await controller.summary('actor-1');
    expect(result).toEqual({ open_cases: 1 });
    expect(actorMock.requireAdmin).toHaveBeenCalledWith('actor-1');
  });

  it('blocks a client role from the dashboard', async () => {
    actorMock.requireAdmin.mockRejectedValue(
      new ForbiddenException('administrator access required'),
    );
    await expect(
      controller.summary('a0000000-0000-4000-8000-000000000002'),
    ).rejects.toThrow(/administrator access required/);
  });

  it('delegates each aggregate to the service', async () => {
    await controller.phaseDistribution('actor-1');
    await controller.timeInPhase('actor-1');
    await controller.paymentAging('actor-1');
    expect(serviceMock.phaseDistribution).toHaveBeenCalledWith(adminActor);
    expect(serviceMock.timeInPhase).toHaveBeenCalledWith(adminActor);
    expect(serviceMock.paymentAging).toHaveBeenCalledWith(adminActor);
  });

  it('protects and delegates global search', async () => {
    await controller.search('VF-2026', 'actor-1');
    expect(actorMock.requireAdmin).toHaveBeenCalledWith('actor-1');
    expect(serviceMock.search).toHaveBeenCalledWith(adminActor, 'VF-2026');
  });
});
