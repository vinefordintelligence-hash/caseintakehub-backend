import { Test } from '@nestjs/testing';
import { FundingController } from './funding.controller';
import { FundingService } from './funding.service';
import { SupabaseIdentityService } from '../identity/supabase-identity.service';
import { getDataSourceToken } from '@nestjs/typeorm';
import { FeaturePolicyService } from './feature-policy.service';
import { FEATURE_POLICY } from './funding-feature.guard';

describe('FundingController', () => {
  it('uses the injected guarded funding service', async () => {
    const funding = { overview: jest.fn() };
    const module = await Test.createTestingModule({
      controllers: [FundingController],
      providers: [
        { provide: FundingService, useValue: funding },
        { provide: SupabaseIdentityService, useValue: { verify: jest.fn() } },
        { provide: getDataSourceToken(), useValue: { query: jest.fn() } },
        {
          provide: FeaturePolicyService,
          useValue: { require: jest.fn(), state: jest.fn(), update: jest.fn() },
        },
      ],
    }).compile();
    expect(module.get(FundingController)).toBeDefined();
  });

  it('requires automatedFundReleaseEnabled for authoritative completion', () => {
    expect(
      Reflect.getMetadata(FEATURE_POLICY, FundingController.prototype.release),
    ).toEqual(['automatedFundReleaseEnabled']);
    expect(
      Reflect.getMetadata(
        FEATURE_POLICY,
        FundingController.prototype.prepareRelease,
      ),
    ).not.toContain('automatedFundReleaseEnabled');
  });
});
