import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { FEATURE_NAMES, FeaturePolicyService } from './feature-policy.service';

const admin: VerifiedIdentity = {
  actorId: 'admin-a',
  organizationId: 'org-a',
  role: 'admin',
  supabaseUserId: 'sup-a',
};
const client: VerifiedIdentity = {
  actorId: 'client-a',
  organizationId: 'org-a',
  role: 'client',
  supabaseUserId: 'sup-c',
};
const investigator: VerifiedIdentity = {
  actorId: 'investigator-a',
  organizationId: 'org-a',
  role: 'investigator',
  supabaseUserId: 'sup-i',
};

describe('FeaturePolicyService', () => {
  let query: jest.Mock;
  let service: FeaturePolicyService;

  beforeEach(() => {
    query = jest.fn();
    const db = {
      query,
      transaction: jest.fn(async (callback) => callback({ query })),
    };
    service = new FeaturePolicyService(db as any);
  });

  it('defaults every sensitive feature off when no setting exists', async () => {
    query.mockResolvedValueOnce([]);
    const state = await service.state(admin);
    expect(Object.keys(state.effective)).toEqual(FEATURE_NAMES);
    expect(
      Object.values(state.effective).every((value) => value === false),
    ).toBe(true);
    expect(query.mock.calls[0][1][0]).toBe('org-a');
  });

  it('makes children ineffective when a stored parent is disabled', async () => {
    query.mockResolvedValueOnce([
      { setting_key: 'features.trustFundEnabled', setting_value: true },
    ]);
    const state = await service.state(admin);
    expect(state.stored.trustFundEnabled).toBe(true);
    expect(state.effective.trustFundEnabled).toBe(false);
  });

  it.each([client, investigator])(
    'rejects non-admin feature mutation for role $role',
    async (identity) => {
      await expect(
        service.update({ features: { fundingEnabled: true } }, identity),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('cannot enable a child without its required parents', async () => {
    query.mockResolvedValueOnce([]);
    await expect(
      service.update({ features: { grantApplicationsEnabled: true } }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires explicit confirmation for high-risk enablement', async () => {
    query.mockResolvedValueOnce([
      { setting_key: 'features.fundingEnabled', setting_value: true },
      { setting_key: 'features.walletConnectionsEnabled', setting_value: true },
    ]);
    await expect(
      service.update({ features: { onChainEscrowEnabled: true } }, admin),
    ).rejects.toThrow('explicit confirmation');
  });

  it('persists authorized changes and writes immutable audit metadata', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValue([]);
    const result = await service.update(
      { features: { fundingEnabled: true, treasuryFundingEnabled: true } },
      admin,
      'corr-1',
    );
    expect(result.effective.fundingEnabled).toBe(true);
    expect(result.effective.treasuryFundingEnabled).toBe(true);
    const settingsCalls = query.mock.calls.filter((call) =>
      String(call[0]).includes('organization_settings'),
    );
    const auditCalls = query.mock.calls.filter((call) =>
      String(call[0]).includes('FEATURE_TOGGLE_CHANGED'),
    );
    expect(settingsCalls).toHaveLength(3);
    expect(auditCalls).toHaveLength(2);
    expect(auditCalls[0][1][0]).toBe('org-a');
    expect(auditCalls[0][1][1]).toBe('admin-a');
    expect(auditCalls[0][0]).toContain("'organization_feature',$1");
    expect(auditCalls[0][1][2]).toContain('corr-1');
    expect(settingsCalls[1][0]).toContain('enabled_at=CASE');
  });

  it('explicitly disables dependent stored state when funding is disabled', async () => {
    query
      .mockResolvedValueOnce(
        FEATURE_NAMES.map((name) => ({
          setting_key: `features.${name}`,
          setting_value: true,
        })),
      )
      .mockResolvedValue([]);
    const result = await service.update(
      { features: { fundingEnabled: false } },
      admin,
    );
    expect(Object.values(result.stored).every((value) => value === false)).toBe(
      true,
    );
  });
});
