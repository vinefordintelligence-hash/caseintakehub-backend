import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { CasesService } from './cases.service';
import { CreateCaseDto } from './dto/create-case.dto';
import { UpdateCaseDto } from './dto/update-case.dto';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { Permissions } from '../core/decorators/permissions.decorator';
import { CaseLifecycleDto } from './dto/case-lifecycle.dto';

@Controller('cases')
@UseGuards(SupabaseIdentityGuard)
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Post()
  @Permissions('cases.create')
  create(@Body() createCaseDto: CreateCaseDto, @Req() req: Request) {
    return this.casesService.create(createCaseDto, this.identity(req));
  }

  @Get()
  @Permissions('cases.read')
  findAll(@Req() req: Request) {
    return this.casesService.findAll(this.identity(req));
  }

  @Get(':id')
  @Permissions('cases.read')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.casesService.findOne(id, this.identity(req));
  }

  @Patch(':id')
  @Permissions('cases.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateCaseDto: UpdateCaseDto,
    @Req() req: Request,
  ) {
    return this.casesService.update(id, updateCaseDto, this.identity(req));
  }

  @Delete(':id')
  @Permissions('cases.update')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.casesService.remove(id, this.identity(req));
  }

  @Post(':id/close')
  @Permissions('cases.update')
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CaseLifecycleDto,
    @Req() req: Request,
  ) {
    return this.casesService.close(id, dto.reason, this.identity(req));
  }

  @Post(':id/archive')
  @Permissions('cases.update')
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CaseLifecycleDto,
    @Req() req: Request,
  ) {
    return this.casesService.archive(id, dto.reason, this.identity(req));
  }

  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
