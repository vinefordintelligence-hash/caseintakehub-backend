import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import {
  FundingFeatureGuard,
  RequireFeatures,
} from '../funding/funding-feature.guard';
import { TreasuryService } from './treasury.service';

@Controller('treasury')
@UseGuards(SupabaseIdentityGuard, FundingFeatureGuard)
export class TreasuryController {
  constructor(private readonly treasury: TreasuryService) {}
  @Get('vault') @RequireFeatures('walletConnectionsEnabled') overview(
    @Req() req: Request,
  ) {
    return this.treasury.overview(this.identity(req));
  }
  @Get('managed-accounts')
  @RequireFeatures('treasuryFundingEnabled')
  managedAccounts(@Req() req: Request) {
    return this.treasury.managedAccounts(this.identity(req));
  }
  @Post('deposit-addresses')
  @RequireFeatures('walletConnectionsEnabled')
  assign(@Body() body: Record<string, unknown>, @Req() req: Request) {
    return this.treasury.assignAddress(body, this.identity(req));
  }
  @Get('deposit-addresses')
  @RequireFeatures('walletConnectionsEnabled')
  addresses(@Req() req: Request) {
    return this.treasury.addressesFor(this.identity(req));
  }
  @Get('deposits') @RequireFeatures('walletConnectionsEnabled') deposits(
    @Req() req: Request,
  ) {
    return this.treasury.deposits(this.identity(req));
  }
  @Get('funding') @RequireFeatures('treasuryFundingEnabled') funding(
    @Req() req: Request,
  ) {
    return this.treasury.funding(this.identity(req));
  }
  @Post('funding') @RequireFeatures('treasuryFundingEnabled') createFunding(
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.treasury.createFunding(body, this.identity(req));
  }
  @Patch('funding/:id/status')
  @RequireFeatures('treasuryFundingEnabled')
  reviewFunding(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.treasury.reviewFunding(id, body, this.identity(req));
  }
  @Post('deposit-addresses/:id/transactions')
  @RequireFeatures('walletConnectionsEnabled')
  verify(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.treasury.verifyDeposit(id, body, this.identity(req));
  }
  @Post('deposit-addresses/:id/scan')
  @RequireFeatures('walletConnectionsEnabled')
  scan(@Param('id') id: string, @Req() req: Request) {
    return this.treasury.scanAddress(id, this.identity(req));
  }
  @Post('chain-withdrawals')
  @RequireFeatures('walletConnectionsEnabled')
  requestWithdrawal(
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.treasury.requestWithdrawal(body, this.identity(req));
  }
  @Get('chain-withdrawals')
  @RequireFeatures('walletConnectionsEnabled')
  withdrawals(@Req() req: Request) {
    return this.treasury.withdrawals(this.identity(req));
  }
  @Patch('chain-withdrawals/:id/approve')
  @RequireFeatures('walletConnectionsEnabled')
  approve(@Param('id') id: string, @Req() req: Request) {
    return this.treasury.approveWithdrawal(id, this.identity(req));
  }
  @Post('chain-withdrawals/:id/execute')
  @RequireFeatures('walletConnectionsEnabled')
  execute() {
    return this.treasury.executeWithdrawal();
  }
  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
