import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

export const FEATURE_NAMES = [
  'fundingEnabled',
  'trustFundEnabled',
  'grantApplicationsEnabled',
  'recipientMilestonesEnabled',
  'evidenceSubmissionsEnabled',
  'independentReviewsEnabled',
  'milestoneVotingEnabled',
  'treasuryFundingEnabled',
  'automatedFundReleaseEnabled',
  'walletConnectionsEnabled',
  'onChainEscrowEnabled',
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureState = Record<FeatureName, boolean>;

export const FEATURE_DEPENDENCIES: Record<FeatureName, FeatureName[]> = {
  fundingEnabled: [],
  trustFundEnabled: ['fundingEnabled'],
  grantApplicationsEnabled: ['fundingEnabled', 'trustFundEnabled'],
  recipientMilestonesEnabled: ['fundingEnabled', 'trustFundEnabled'],
  evidenceSubmissionsEnabled: ['fundingEnabled', 'trustFundEnabled'],
  independentReviewsEnabled: ['fundingEnabled', 'trustFundEnabled'],
  milestoneVotingEnabled: ['fundingEnabled', 'trustFundEnabled'],
  treasuryFundingEnabled: ['fundingEnabled'],
  automatedFundReleaseEnabled: ['fundingEnabled', 'treasuryFundingEnabled'],
  walletConnectionsEnabled: ['fundingEnabled'],
  onChainEscrowEnabled: ['fundingEnabled', 'walletConnectionsEnabled'],
};

const HIGH_RISK = new Set<FeatureName>([
  'automatedFundReleaseEnabled',
  'onChainEscrowEnabled',
]);
const key = (feature: FeatureName) => `features.${feature}`;

@Injectable()
export class FeaturePolicyService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async state(
    identity: VerifiedIdentity,
    manager: DataSource | EntityManager = this.db,
  ): Promise<{ stored: FeatureState; effective: FeatureState }> {
    const rows = await manager.query<
      Array<{ setting_key: string; setting_value: unknown }>
    >(
      `SELECT setting_key,setting_value FROM public.organization_settings
       WHERE organization_id=$1 AND setting_key=ANY($2::text[])`,
      [identity.organizationId, FEATURE_NAMES.map(key)],
    );
    const stored = Object.fromEntries(
      FEATURE_NAMES.map((name) => [
        name,
        rows.find((row) => row.setting_key === key(name))?.setting_value ===
          true,
      ]),
    ) as FeatureState;
    return { stored, effective: this.effective(stored) };
  }

  async require(
    identity: VerifiedIdentity,
    required: FeatureName[],
  ): Promise<void> {
    const { effective } = await this.state(identity);
    const disabled = required.find((feature) => !effective[feature]);
    if (disabled)
      throw new ForbiddenException(
        `${disabled} is disabled for this organization`,
      );
  }

  async update(
    body: Record<string, unknown>,
    identity: VerifiedIdentity,
    correlationId?: string,
  ): Promise<{ stored: FeatureState; effective: FeatureState }> {
    if (!['admin', 'super_admin'].includes(identity.role))
      throw new ForbiddenException(
        'organization administrator access required',
      );
    const requested = body.features;
    if (!requested || typeof requested !== 'object' || Array.isArray(requested))
      throw new BadRequestException('features object is required');
    const changes = Object.entries(requested as Record<string, unknown>);
    if (
      !changes.length ||
      changes.some(
        ([name, value]) =>
          !FEATURE_NAMES.includes(name as FeatureName) ||
          typeof value !== 'boolean',
      )
    )
      throw new BadRequestException(
        'feature values must be recognized booleans',
      );
    const confirmations = Array.isArray(body.confirmations)
      ? body.confirmations
      : [];
    return this.db.transaction(async (manager) => {
      const current = await this.state(identity, manager);
      const next: FeatureState = { ...current.stored };
      for (const [name, value] of changes as Array<[FeatureName, boolean]>) {
        if (value && HIGH_RISK.has(name) && !confirmations.includes(name))
          throw new BadRequestException(
            `explicit confirmation is required to enable ${name}`,
          );
        next[name] = value;
      }
      for (const [feature, value] of changes as Array<[FeatureName, boolean]>) {
        if (
          value &&
          FEATURE_DEPENDENCIES[feature].some((parent) => !next[parent])
        )
          throw new BadRequestException(
            `${feature} requires ${FEATURE_DEPENDENCIES[feature].join(' and ')}`,
          );
      }
      this.cascadeDisabled(next);
      for (const feature of FEATURE_NAMES.filter(
        (name) => current.stored[name] !== next[name],
      )) {
        await manager.query(
          `INSERT INTO public.organization_settings (organization_id,setting_key,setting_value,updated_by,enabled_at)
           VALUES ($1,$2,$3::jsonb,$4,CASE WHEN $3::jsonb='true'::jsonb THEN clock_timestamp() ELSE NULL END)
           ON CONFLICT (organization_id,setting_key) DO UPDATE SET
           enabled_at=CASE WHEN excluded.setting_value='true'::jsonb AND organization_settings.setting_value<>'true'::jsonb THEN clock_timestamp()
                           WHEN excluded.setting_value<>'true'::jsonb THEN NULL ELSE organization_settings.enabled_at END,
           setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=now()`,
          [
            identity.organizationId,
            key(feature),
            JSON.stringify(next[feature]),
            identity.actorId,
          ],
        );
        await manager.query(
          `INSERT INTO public.audit_logs (organization_id,user_id,action,resource_type,resource_id,changes)
           VALUES ($1,$2,'FEATURE_TOGGLE_CHANGED','organization_feature',$1,$3::jsonb)`,
          [
            identity.organizationId,
            identity.actorId,
            JSON.stringify({
              feature,
              previous_state: current.stored[feature],
              new_state: next[feature],
              correlation_id: correlationId ?? null,
            }),
          ],
        );
      }
      return { stored: next, effective: this.effective(next) };
    });
  }

  private effective(stored: FeatureState): FeatureState {
    const effective = { ...stored };
    this.cascadeDisabled(effective);
    return effective;
  }

  private cascadeDisabled(state: FeatureState): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const feature of FEATURE_NAMES) {
        if (
          state[feature] &&
          FEATURE_DEPENDENCIES[feature].some((parent) => !state[parent])
        ) {
          state[feature] = false;
          changed = true;
        }
      }
    }
  }
}
