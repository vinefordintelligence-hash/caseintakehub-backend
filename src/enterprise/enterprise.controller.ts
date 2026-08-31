import {
  Body,
  Controller,
  GoneException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import {
  FundingFeatureGuard,
  RequireFeatures,
} from '../funding/funding-feature.guard';
import { EnterpriseService } from './enterprise.service';
import { Permissions } from '../core/decorators/permissions.decorator';

/**
 * Additive administration/intelligence API. This does not replace legacy
 * scaffold endpoints until a separately reviewed frontend cutover.
 */
@Controller('enterprise')
@UseGuards(SupabaseIdentityGuard)
export class EnterpriseController {
  constructor(private readonly enterprise: EnterpriseService) {}

  @Get('organizations')
  @Permissions('organizations.read')
  organizations(@Headers('x-actor-id') actorId?: string) {
    return this.enterprise.organizations(actorId);
  }

  @Get('organizations/:organizationId/members')
  @Permissions('users.read')
  members(
    @Param('organizationId') organizationId: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.members(organizationId, actorId);
  }

  @Post('organizations/:organizationId/members')
  @Permissions('users.manage')
  addMember(
    @Param('organizationId') organizationId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.addMember(organizationId, body, actorId);
  }

  @Get('organizations/:organizationId/settings')
  @Permissions('organizations.read')
  settings(
    @Param('organizationId') organizationId: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.settings(organizationId, actorId);
  }

  @Patch('organizations/:organizationId/settings/:key')
  @Permissions('organizations.manage')
  setSetting(
    @Param('organizationId') organizationId: string,
    @Param('key') key: string,
    @Body() body: { value?: unknown },
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.setSetting(organizationId, key, body.value, actorId);
  }

  @Get('cases/:caseId/assignments')
  @Permissions('cases.read')
  assignments(
    @Param('caseId') caseId: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.assignments(caseId, actorId);
  }

  @Post('cases/:caseId/assignments')
  @Permissions('cases.assign')
  assign(
    @Param('caseId') caseId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.assign(caseId, body, actorId);
  }

  @Get('cases/:caseId/assignment-transfers')
  @Permissions('cases.read')
  assignmentTransfers(
    @Param('caseId') caseId: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.assignmentTransfers(caseId, actorId);
  }

  @Post('cases/:caseId/assignment-transfers')
  @Permissions('cases.assign')
  requestAssignmentTransfer(
    @Param('caseId') caseId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.requestAssignmentTransfer(caseId, body, actorId);
  }

  @Post('assignment-transfers/:transferId/approve')
  @Permissions('cases.assign')
  approveAssignmentTransfer(
    @Param('transferId') transferId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.approveAssignmentTransfer(transferId, body, actorId);
  }

  @Post('assignment-transfers/:transferId/complete')
  @Permissions('cases.assign')
  completeAssignmentTransfer(
    @Param('transferId') transferId: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.completeAssignmentTransfer(transferId, actorId);
  }

  @Get('treasury/accounts')
  @RequireFeatures('treasuryFundingEnabled')
  @UseGuards(FundingFeatureGuard)
  treasuryAccounts(@Headers('x-actor-id') actorId?: string) {
    return this.enterprise.treasuryAccounts(actorId);
  }

  @Post('treasury/accounts')
  @RequireFeatures('treasuryFundingEnabled')
  @UseGuards(FundingFeatureGuard)
  createTreasuryAccount(
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.createTreasuryAccount(body, actorId);
  }

  @Get('treasury/accounts/:accountId/ledger')
  @RequireFeatures('treasuryFundingEnabled')
  @UseGuards(FundingFeatureGuard)
  treasuryLedger(
    @Param('accountId') accountId: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.treasuryLedger(accountId, actorId);
  }

  @Post('treasury/funding')
  @RequireFeatures('treasuryFundingEnabled')
  @UseGuards(FundingFeatureGuard)
  createTreasuryFunding(
    @Body() _body: Record<string, unknown>,
    @Headers('x-actor-id') _actorId?: string,
  ) {
    throw new GoneException(
      'Direct Treasury credits are disabled; use the verified /treasury/funding review workflow',
    );
  }

  @Get('treasury/funding')
  @RequireFeatures('treasuryFundingEnabled')
  @UseGuards(FundingFeatureGuard)
  treasuryFunding(@Headers('x-actor-id') actorId?: string) {
    return this.enterprise.treasuryFunding(actorId);
  }

  @Get('cases/:caseId/assets')
  assets(
    @Param('caseId') caseId: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.assets(caseId, actorId);
  }

  @Post('cases/:caseId/assets')
  createAsset(
    @Param('caseId') caseId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.createAsset(caseId, body, actorId);
  }

  @Get('cases/:caseId/wallets')
  wallets(
    @Param('caseId') caseId: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.wallets(caseId, actorId);
  }

  @Post('cases/:caseId/wallets')
  createWallet(
    @Param('caseId') caseId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.createWallet(caseId, body, actorId);
  }

  @Get('cases/:caseId/transactions')
  transactions(
    @Param('caseId') caseId: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.transactions(caseId, actorId);
  }

  @Post('cases/:caseId/transactions')
  createTransaction(
    @Param('caseId') caseId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.createTransaction(caseId, body, actorId);
  }

  @Get('cases/:caseId/traces')
  traces(
    @Param('caseId') caseId: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.traces(caseId, actorId);
  }

  @Post('cases/:caseId/traces')
  createTrace(
    @Param('caseId') caseId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.createTrace(caseId, body, actorId);
  }

  @Get('cases/:caseId/recoveries')
  recoveries(
    @Param('caseId') caseId: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.recoveries(caseId, actorId);
  }

  @Post('cases/:caseId/recoveries')
  createRecovery(
    @Param('caseId') caseId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.enterprise.createRecovery(caseId, body, actorId);
  }
}
