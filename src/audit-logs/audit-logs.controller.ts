import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditLogsService, AuditLogFilters } from './audit-logs.service';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { Permissions } from '../core/decorators/permissions.decorator';

@ApiTags('audit-logs')
@Controller('audit-logs')
@UseGuards(SupabaseIdentityGuard)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @Permissions('audit.read')
  @ApiOperation({
    summary:
      'List audit log entries for the organization (administrators only; optional filters)',
  })
  async findAll(
    @Query() query: AuditLogQueryDto,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    const filters: AuditLogFilters = {
      organizationId: identity.organizationId,
      action: query.action || undefined,
      resourceType: query.resourceType || undefined,
      resourceId: query.resourceId || undefined,
      caseId: query.caseId || undefined,
      limit: query.limit,
      offset: query.offset,
    };
    const [items, total] = await Promise.all([
      this.auditLogsService.findAll(filters),
      this.auditLogsService.count(filters),
    ]);
    return { items, total };
  }

  @Get('export')
  @Permissions('audit.read')
  @Header('content-type', 'text/csv')
  @Header(
    'content-disposition',
    'attachment; filename="vineford-audit-log.csv"',
  )
  @ApiOperation({ summary: 'Export the organization audit log as CSV' })
  async export(
    @Query() query: AuditLogQueryDto,
    @CurrentUser() identity: VerifiedIdentity,
  ): Promise<string> {
    const items = await this.auditLogsService.findAll({
      organizationId: identity.organizationId,
      action: query.action || undefined,
      resourceType: query.resourceType || undefined,
      resourceId: query.resourceId || undefined,
      caseId: query.caseId || undefined,
      limit: 10000,
    });
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      'created_at',
      'actor',
      'action',
      'resource_type',
      'resource_id',
      'case_id',
      'changes',
    ];
    const lines = items.map((row) =>
      [
        esc(row.created_at),
        esc(row.user_email ?? row.user_name),
        esc(row.action),
        esc(row.resource_type),
        esc(row.resource_id),
        esc(row.case_id),
        esc(row.changes ? JSON.stringify(row.changes) : ''),
      ].join(','),
    );
    return [header.join(','), ...lines].join('\n');
  }

  @Post()
  @Permissions('audit.write')
  @ApiOperation({
    summary:
      'Write an audit log entry (administrators only; used by internal tooling)',
  })
  create(
    @Body() dto: CreateAuditLogDto,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.auditLogsService.create({
      organizationId: identity.organizationId,
      userId: identity.actorId,
      action: dto.action,
      resourceType: dto.resource_type,
      resourceId: dto.resource_id,
      caseId: dto.case_id ?? undefined,
      changes: dto.changes ?? null,
    });
  }
}
