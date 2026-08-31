import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../core/decorators/roles.decorator';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { CaseAssignmentsService } from './case-assignments.service';
import {
  CreateAssignmentDto,
  ReassignAssignmentDto,
  RemoveAssignmentDto,
} from './dto/assignment.dto';

@Controller('case-assignments')
@UseGuards(SupabaseIdentityGuard)
export class CaseAssignmentsController {
  constructor(private readonly service: CaseAssignmentsService) {}
  private identity(req: Request) {
    return (req as Request & { vfIdentity: VerifiedIdentity }).vfIdentity;
  }

  @Get('overview')
  @Roles('admin', 'super_admin', 'investigator')
  overview(
    @Req() req: Request,
    @Query() filters: Record<string, string | undefined>,
  ) {
    return this.service.overview(this.identity(req), filters);
  }

  @Get('cases/:caseId/history')
  @Roles('admin', 'super_admin', 'investigator')
  history(@Req() req: Request, @Param('caseId') caseId: string) {
    return this.service.history(caseId, this.identity(req));
  }

  @Post()
  @Roles('admin', 'super_admin')
  create(@Req() req: Request, @Body() dto: CreateAssignmentDto) {
    return this.service.create(dto, this.identity(req));
  }

  @Patch(':id/reassign')
  @Roles('admin', 'super_admin')
  reassign(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ReassignAssignmentDto,
  ) {
    return this.service.reassign(id, dto, this.identity(req));
  }

  @Delete(':id')
  @Roles('admin', 'super_admin')
  remove(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RemoveAssignmentDto,
  ) {
    return this.service.remove(id, dto, this.identity(req));
  }
}
