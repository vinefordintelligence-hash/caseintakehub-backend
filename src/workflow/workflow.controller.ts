import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { WorkflowService, WorkflowView } from './workflow.service';
import { AdvancePhaseDto } from './dto/advance-phase.dto';
import { CreateClientActionDto } from './dto/create-client-action.dto';
import { IssueHandoffDto } from './dto/issue-handoff.dto';
import { VerifyHandoffDto } from './dto/verify-handoff.dto';
import { RevokeHandoffDto } from './dto/revoke-handoff.dto';
import { SetLegalHoldDto } from './dto/set-legal-hold.dto';

@ApiTags('workflow')
@Controller('workflow')
@UseGuards(SupabaseIdentityGuard)
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Get('cases/:caseId')
  @ApiOperation({
    summary:
      'Read-only workflow state for a case (view=admin includes audit; view=client masks sensitive data)',
  })
  @ApiQuery({ name: 'view', required: false, enum: ['admin', 'client'] })
  getCaseWorkflow(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Req() req: Request,
    @Query('view') view?: WorkflowView,
  ) {
    const actorId = this.identity(req).actorId;
    return this.workflowService.getCaseWorkflow(
      caseId,
      view ?? 'admin',
      actorId,
    );
  }

  @Get('cases/:caseId/timeline')
  @ApiOperation({
    summary: 'Chronological case timeline events (client view is filtered)',
  })
  @ApiQuery({ name: 'view', required: false, enum: ['admin', 'client'] })
  getCaseTimeline(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Req() req: Request,
    @Query('view') view?: WorkflowView,
  ) {
    const actorId = this.identity(req).actorId;
    return this.workflowService.getCaseTimeline(
      caseId,
      view ?? 'admin',
      actorId,
    );
  }

  @Patch('cases/:caseId/legal-hold')
  @ApiOperation({
    summary:
      'Place or lift a legal hold on a case (administrators only; audited)',
  })
  setLegalHold(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Req() req: Request,
    @Body() dto: SetLegalHoldDto,
  ) {
    const actorId = this.identity(req).actorId;
    return this.workflowService.setLegalHold(caseId, actorId, dto);
  }

  @Get('cases/:caseId/history')
  @ApiOperation({ summary: 'Historical record counts for a case' })
  getCaseHistory(@Param('caseId', ParseUUIDPipe) caseId: string) {
    return this.workflowService.getCaseHistory(caseId);
  }

  @Post('cases/:caseId/advance')
  @ApiOperation({
    summary: 'Advance the case workflow phase (audited)',
  })
  advancePhase(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Req() req: Request,
    @Body() dto: AdvancePhaseDto,
  ) {
    const actorId = this.identity(req).actorId;
    return this.workflowService.advancePhase(caseId, actorId, dto);
  }

  @Post('cases/:caseId/complete-review')
  @ApiOperation({
    summary: 'Complete case review (requires all active requirements verified)',
  })
  completeReview(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Req() req: Request,
  ) {
    const actorId = this.identity(req).actorId;
    return this.workflowService.completeReview(caseId, actorId);
  }

  @Post('cases/:caseId/client-actions')
  @ApiOperation({
    summary:
      'Phase 6 — create the Next Authorized Client Action (gated: requires verification complete)',
  })
  createClientAction(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Req() req: Request,
    @Body() dto: CreateClientActionDto,
  ) {
    const actorId = this.identity(req).actorId;
    return this.workflowService.createClientAction(caseId, actorId, dto);
  }

  @Get('cases/:caseId/client-actions')
  @ApiOperation({ summary: 'List client actions for a case' })
  findClientActions(@Param('caseId', ParseUUIDPipe) caseId: string) {
    return this.workflowService.findClientActions(caseId);
  }

  @Get('client-actions/:id')
  @ApiOperation({ summary: 'Get a single client action' })
  findClientAction(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflowService.findClientAction(id);
  }

  @Get('client-actions/:id/acceptance')
  @ApiOperation({
    summary: 'Authoritative client acceptance preview or completion',
  })
  getClientAcceptance(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.workflowService.getClientAcceptance(id, this.identity(req));
  }

  @Post('client-actions/:id/acceptance')
  @ApiOperation({
    summary: 'Submit an authenticated client acceptance confirmation',
  })
  submitClientAcceptance(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Body() body: { acknowledged?: boolean; acknowledgement_version?: string },
  ) {
    return this.workflowService.submitClientAcceptance(
      id,
      this.identity(req),
      body,
    );
  }

  @Get('cases/:caseId/handoff')
  @ApiOperation({
    summary:
      'Phase 6 — read the authorization-based handoff status (never returns the token)',
  })
  @ApiQuery({ name: 'view', required: false, enum: ['admin', 'client'] })
  getPhase6HandoffStatus(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Req() req: Request,
    @Query('view') view?: WorkflowView,
  ) {
    const identity = this.identity(req);
    const authorizedView: WorkflowView =
      identity.role === 'client' ? 'client' : (view ?? 'admin');
    return this.workflowService.getPhase6HandoffStatus(
      caseId,
      authorizedView,
      identity.actorId,
    );
  }

  @Post('cases/:caseId/handoff/issue')
  @ApiOperation({
    summary:
      'Phase 6 — issue an authorization handoff for the approved next client action (returns a signed token; the downstream portal must present it to verify)',
  })
  issuePhase6Handoff(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Req() req: Request,
    @Body() dto: IssueHandoffDto,
  ) {
    const actorId = this.identity(req).actorId;
    return this.workflowService.issuePhase6Handoff(caseId, actorId, dto);
  }

  @Post('handoff/verify')
  @ApiOperation({
    summary:
      'Phase 6 — verify a handoff token against live workflow state (SANDBOX / DEMO; simulated only, no real funds)',
  })
  verifyPhase6Handoff(@Req() req: Request, @Body() dto: VerifyHandoffDto) {
    const actorId = this.identity(req).actorId;
    return this.workflowService.verifyPhase6Handoff(dto, actorId);
  }

  @Post('handoff/:grantId/revoke')
  @ApiOperation({
    summary: 'Phase 6 — revoke an issued handoff grant (administrators only)',
  })
  revokePhase6Handoff(
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Req() req: Request,
    @Body() dto: RevokeHandoffDto,
  ) {
    const actorId = this.identity(req).actorId;
    return this.workflowService.revokePhase6Handoff(
      grantId,
      actorId,
      dto?.note,
    );
  }

  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
