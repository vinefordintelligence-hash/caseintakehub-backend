import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { WithdrawalsService } from './withdrawals.service';
import type { WorkflowView } from '../workflow/workflow.service';
import { SubmitWithdrawalRequestDto } from './dto/submit-withdrawal-request.dto';
import { WithdrawalDecisionDto } from './dto/withdrawal-decision.dto';
import { RespondWithdrawalRequestDto } from './dto/respond-withdrawal-request.dto';

@ApiTags('withdrawals')
@Controller('withdrawals')
@UseGuards(SupabaseIdentityGuard)
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Phase 6 — the authorized client submits a withdrawal request. Gated on verification (Phase 5) and a valid, unexpired handoff token. Status is always pending_review. SANDBOX / DEMO only.',
  })
  submit(
    @Headers('x-actor-id') actorId: string,
    @Body() dto: SubmitWithdrawalRequestDto,
  ) {
    return this.withdrawalsService.submit(dto.case_id, actorId, dto);
  }

  @Get('cases/:caseId')
  @ApiOperation({
    summary:
      'Withdrawal requests for a case (client view masks banking details and hides internal admin fields).',
  })
  @ApiQuery({ name: 'view', required: false, enum: ['admin', 'client'] })
  findByCase(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Query('view') view?: WorkflowView,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.withdrawalsService.findByCase(caseId, view ?? 'admin', actorId);
  }

  @Get()
  @ApiOperation({
    summary:
      'Admin review queue (control room) — withdrawal requests with case reference, client, amount, request date, status and workflow state. Administrators only.',
  })
  @ApiQuery({ name: 'status', required: false })
  list(
    @Headers('x-actor-id') actorId: string,
    @Query('status') status?: string,
  ) {
    return this.withdrawalsService.list(actorId, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A single withdrawal request.' })
  @ApiQuery({ name: 'view', required: false, enum: ['admin', 'client'] })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('view') view?: WorkflowView,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.withdrawalsService.findOne(id, view ?? 'admin', actorId);
  }

  @Post(':id/decision')
  @ApiOperation({
    summary:
      'Admin decision — APPROVE / REJECT / REQUEST MORE INFORMATION. Approving records the decision and NEVER executes a real financial transfer (SANDBOX / DEMO only).',
  })
  decision(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-actor-id') actorId: string,
    @Body() dto: WithdrawalDecisionDto,
  ) {
    return this.withdrawalsService.decision(id, actorId, dto);
  }

  @Post(':id/respond')
  @ApiOperation({
    summary:
      'Client responds to a more-information request (status returns to pending_review).',
  })
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-actor-id') actorId: string,
    @Body() dto: RespondWithdrawalRequestDto,
  ) {
    return this.withdrawalsService.respond(id, actorId, dto.response);
  }
}
