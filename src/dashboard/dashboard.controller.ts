import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { ActorService } from '../common/actor.service';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';

@ApiTags('dashboard')
@Controller('dashboard')
@UseGuards(SupabaseIdentityGuard)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly actorService: ActorService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Organization summary metrics (administrators only)',
  })
  summary(@Headers('x-actor-id') actorId?: string) {
    return this.actorService
      .requireAdmin(actorId)
      .then((actor) => this.dashboardService.summary(actor));
  }

  @Get('phase-distribution')
  @ApiOperation({ summary: 'Cases by workflow phase (administrators only)' })
  phaseDistribution(@Headers('x-actor-id') actorId?: string) {
    return this.actorService
      .requireAdmin(actorId)
      .then((actor) => this.dashboardService.phaseDistribution(actor));
  }

  @Get('time-in-phase')
  @ApiOperation({
    summary: 'Average time in current phase (administrators only)',
  })
  timeInPhase(@Headers('x-actor-id') actorId?: string) {
    return this.actorService
      .requireAdmin(actorId)
      .then((actor) => this.dashboardService.timeInPhase(actor));
  }

  @Get('payment-aging')
  @ApiOperation({
    summary: 'Outstanding invoice aging buckets (administrators only)',
  })
  paymentAging(@Headers('x-actor-id') actorId?: string) {
    return this.actorService
      .requireAdmin(actorId)
      .then((actor) => this.dashboardService.paymentAging(actor));
  }

  @Get('cases')
  @ApiOperation({
    summary: 'Organization case list with client details (administrators only)',
  })
  listCases(@Headers('x-actor-id') actorId?: string) {
    return this.actorService
      .requireAdmin(actorId)
      .then((actor) => this.dashboardService.listCases(actor));
  }

  @Get('cases/:caseId/detail')
  caseDetail(
    @Param('caseId') caseId: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.actorService
      .requireAdmin(actorId)
      .then((actor) => this.dashboardService.caseDetail(actor, caseId));
  }

  @Get('cases/:caseId/modules/:module')
  caseModule(
    @Param('caseId') caseId: string,
    @Param('module') module: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.actorService
      .requireAdmin(actorId)
      .then((actor) => this.dashboardService.caseModule(actor, caseId, module));
  }

  @Post('cases/:caseId/modules/:module')
  createCaseModuleRecord(
    @Param('caseId') caseId: string,
    @Param('module') module: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.actorService
      .requireAdmin(actorId)
      .then((actor) =>
        this.dashboardService.createCaseModuleRecord(
          actor,
          caseId,
          module,
          body,
        ),
      );
  }

  @Patch('cases/:caseId/modules/:module/:recordId')
  updateCaseModuleRecord(
    @Param('caseId') caseId: string,
    @Param('module') module: string,
    @Param('recordId') recordId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.actorService
      .requireAdmin(actorId)
      .then((actor) =>
        this.dashboardService.updateCaseModuleRecord(
          actor,
          caseId,
          module,
          recordId,
          body,
        ),
      );
  }

  @Get('overview')
  overview(@Headers('x-actor-id') actorId?: string) {
    return this.actorService
      .requireAdmin(actorId)
      .then((actor) => this.dashboardService.overview(actor));
  }

  @Get('search')
  search(
    @Query('q') query: string = '',
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.actorService
      .requireAdmin(actorId)
      .then((actor) => this.dashboardService.search(actor, query));
  }

  @Get('workspaces/:module')
  workspace(
    @Param('module') module: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.actorService
      .requireAdmin(actorId)
      .then((actor) => this.dashboardService.workspace(actor, module));
  }

  @Patch('reviews/:type/:id')
  review(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.actorService
      .requireAdmin(actorId)
      .then((actor) => this.dashboardService.review(actor, type, id, body));
  }

  @Get('access')
  access(@Headers('x-actor-id') actorId?: string) {
    return this.actorService
      .requireAdmin(actorId)
      .then((actor) => this.dashboardService.access(actor));
  }

  @Patch('users/:userId/role')
  updateRole(
    @Param('userId') userId: string,
    @Body() body: { role?: unknown },
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.actorService
      .requireAdmin(actorId)
      .then((actor) =>
        this.dashboardService.updateRole(actor, userId, body.role),
      );
  }
}
