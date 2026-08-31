import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Permissions } from '../core/decorators/permissions.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { SearchLookupDto } from '../search/dto/search-lookup.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@Roles('admin', 'super_admin', 'investigator', 'financial_analyst', 'staff')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @Permissions('reports.generate')
  generate(
    @Body() dto: CreateReportDto,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.reportsService.generate(dto, identity);
  }

  @Get()
  @Permissions('reports.read')
  types() {
    return this.reportsService.types();
  }

  @Get(':id')
  @Permissions('reports.read')
  caseSummary(
    @Param() params: SearchLookupDto,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.reportsService.generate(
      { caseId: params.id, type: 'case_summary', format: 'json' },
      identity,
    );
  }

  @Patch(':id') @Permissions('reports.generate') update() {
    return this.reportsService.update();
  }
  @Delete(':id') @Permissions('reports.generate') remove() {
    return this.reportsService.remove();
  }
}
