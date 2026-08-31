import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { FundingService } from './funding.service';
import { FundingFeatureGuard } from './funding-feature.guard';
import { RequireFeatures } from './funding-feature.guard';

type Payload = Record<string, unknown>;

@Controller('funding')
@UseGuards(SupabaseIdentityGuard, FundingFeatureGuard)
export class FundingController {
  constructor(private readonly funding: FundingService) {}

  @Get('features')
  features(@Req() req: Request) {
    return this.funding.features(this.identity(req));
  }

  @Patch('features')
  setFeatures(
    @Body() body: Payload,
    @Req() req: Request,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.funding.setFeatures(body, this.identity(req), correlationId);
  }

  @Get('overview')
  @RequireFeatures('fundingEnabled')
  overview(@Req() req: Request) {
    return this.funding.overview(this.identity(req));
  }

  @Get('analytics')
  @RequireFeatures('fundingEnabled')
  analytics(@Req() req: Request) {
    return this.funding.analytics(this.identity(req));
  }

  @Post('programs')
  @RequireFeatures('fundingEnabled', 'trustFundEnabled')
  createProgram(@Body() body: Payload, @Req() req: Request) {
    return this.funding.createProgram(body, this.identity(req));
  }

  @Get('programs')
  @RequireFeatures('fundingEnabled', 'trustFundEnabled')
  programs(@Req() req: Request, @Query('status') status?: string) {
    return this.funding.programs(this.identity(req), status);
  }

  @Get('programs/:programId')
  @RequireFeatures('fundingEnabled', 'trustFundEnabled')
  program(@Param('programId') programId: string, @Req() req: Request) {
    return this.funding.program(programId, this.identity(req));
  }

  @Patch('programs/:programId')
  @RequireFeatures('fundingEnabled', 'trustFundEnabled')
  updateProgram(
    @Param('programId') programId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.updateProgram(programId, body, this.identity(req));
  }

  @Post('programs/:programId/recipients')
  @RequireFeatures('fundingEnabled', 'trustFundEnabled')
  addRecipient(
    @Param('programId') programId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.addRecipient(programId, body, this.identity(req));
  }

  @Get('programs/:programId/recipients')
  @RequireFeatures('fundingEnabled', 'trustFundEnabled')
  recipients(@Param('programId') programId: string, @Req() req: Request) {
    return this.funding.recipients(programId, this.identity(req));
  }

  @Post('programs/:programId/reviewers')
  @RequireFeatures('independentReviewsEnabled')
  assignReviewer(
    @Param('programId') programId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.assignReviewer(programId, body, this.identity(req));
  }

  @Post('programs/:programId/supporting-documents')
  @RequireFeatures(
    'fundingEnabled',
    'trustFundEnabled',
    'evidenceSubmissionsEnabled',
  )
  linkSupportingDocument(
    @Param('programId') programId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.linkSupportingDocument(
      programId,
      body,
      this.identity(req),
    );
  }

  @Post('programs/:programId/applications')
  @RequireFeatures('grantApplicationsEnabled')
  apply(
    @Param('programId') programId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.apply(programId, body, this.identity(req));
  }

  @Get('programs/:programId/applications')
  @RequireFeatures('grantApplicationsEnabled')
  applications(@Param('programId') programId: string, @Req() req: Request) {
    return this.funding.applications(programId, this.identity(req));
  }

  @Patch('applications/:applicationId/review')
  @RequireFeatures('grantApplicationsEnabled', 'independentReviewsEnabled')
  reviewApplication(
    @Param('applicationId') applicationId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.reviewApplication(
      applicationId,
      body,
      this.identity(req),
    );
  }

  @Patch('applications/:applicationId/status')
  @RequireFeatures('grantApplicationsEnabled')
  transitionApplication(
    @Param('applicationId') applicationId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.transitionApplication(
      applicationId,
      body,
      this.identity(req),
    );
  }

  @Post('programs/:programId/milestones')
  @RequireFeatures('recipientMilestonesEnabled')
  createMilestone(
    @Param('programId') programId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.createMilestone(programId, body, this.identity(req));
  }

  @Get('programs/:programId/milestones')
  @RequireFeatures('recipientMilestonesEnabled')
  milestones(@Param('programId') programId: string, @Req() req: Request) {
    return this.funding.milestones(programId, this.identity(req));
  }

  @Post('milestones/:milestoneId/submissions')
  @RequireFeatures('recipientMilestonesEnabled', 'evidenceSubmissionsEnabled')
  submitMilestone(
    @Param('milestoneId') milestoneId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.submitMilestone(milestoneId, body, this.identity(req));
  }

  @Post('milestones/:milestoneId/reviews')
  @RequireFeatures('independentReviewsEnabled')
  openReview(
    @Param('milestoneId') milestoneId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.openReview(milestoneId, body, this.identity(req));
  }

  @Post('reviews/:reviewId/votes')
  @RequireFeatures('milestoneVotingEnabled')
  vote(
    @Param('reviewId') reviewId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.vote(reviewId, body, this.identity(req));
  }

  @Post('milestones/:milestoneId/allocations')
  @RequireFeatures('treasuryFundingEnabled')
  allocate(
    @Param('milestoneId') milestoneId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.allocate(milestoneId, body, this.identity(req));
  }

  @Post('milestones/:milestoneId/disputes')
  @RequireFeatures('fundingEnabled', 'trustFundEnabled')
  dispute(
    @Param('milestoneId') milestoneId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.dispute(milestoneId, body, this.identity(req));
  }

  @Patch('disputes/:disputeId/resolve')
  @RequireFeatures('fundingEnabled', 'trustFundEnabled')
  resolveDispute(
    @Param('disputeId') disputeId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.resolveDispute(disputeId, body, this.identity(req));
  }

  @Post('milestones/:milestoneId/releases')
  @RequireFeatures('automatedFundReleaseEnabled')
  release(
    @Param('milestoneId') milestoneId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.release(milestoneId, body, this.identity(req));
  }

  @Post('milestones/:milestoneId/release-requests')
  @RequireFeatures(
    'fundingEnabled',
    'trustFundEnabled',
    'treasuryFundingEnabled',
  )
  prepareRelease(
    @Param('milestoneId') milestoneId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.prepareRelease(milestoneId, body, this.identity(req));
  }

  @Patch('releases/:releaseId/status')
  @RequireFeatures(
    'fundingEnabled',
    'trustFundEnabled',
    'treasuryFundingEnabled',
  )
  transitionRelease(
    @Param('releaseId') releaseId: string,
    @Body() body: Payload,
    @Req() req: Request,
  ) {
    return this.funding.transitionRelease(releaseId, body, this.identity(req));
  }

  @Post('wallet-links/challenge')
  @RequireFeatures('walletConnectionsEnabled')
  walletChallenge(@Body() body: Payload, @Req() req: Request) {
    return this.funding.walletChallenge(body, this.identity(req));
  }

  @Post('wallet-links/verify')
  @RequireFeatures('walletConnectionsEnabled')
  verifyWallet(@Body() body: Payload, @Req() req: Request) {
    return this.funding.verifyWallet(body, this.identity(req));
  }

  @Post('chain-transactions/verify')
  @RequireFeatures('onChainEscrowEnabled')
  verifyChainTransaction(@Body() body: Payload, @Req() req: Request) {
    return this.funding.verifyChainTransaction(body, this.identity(req));
  }

  @Get('escrow/contract')
  @RequireFeatures('onChainEscrowEnabled')
  escrowContract(@Req() req: Request) {
    return this.funding.escrowContract(this.identity(req));
  }

  @Get('notifications')
  @RequireFeatures('fundingEnabled')
  notifications(@Req() req: Request) {
    return this.funding.notifications(this.identity(req));
  }

  @Patch('notifications/:notificationId/read')
  @RequireFeatures('fundingEnabled')
  readNotification(
    @Param('notificationId') notificationId: string,
    @Req() req: Request,
  ) {
    return this.funding.readNotification(notificationId, this.identity(req));
  }

  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
