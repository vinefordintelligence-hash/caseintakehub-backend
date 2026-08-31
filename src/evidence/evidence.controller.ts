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
import { EvidenceService } from './evidence.service';
import { CreateEvidenceDto } from './dto/create-evidence.dto';
import { UpdateEvidenceDto } from './dto/update-evidence.dto';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { Permissions } from '../core/decorators/permissions.decorator';

@Controller('evidence')
@UseGuards(SupabaseIdentityGuard)
export class EvidenceController {
  constructor(private readonly evidenceService: EvidenceService) {}

  @Post()
  @Permissions('evidence.manage')
  create(@Body() createEvidenceDto: CreateEvidenceDto, @Req() req: Request) {
    return this.evidenceService.create(createEvidenceDto, this.identity(req));
  }

  @Get()
  @Permissions('evidence.read')
  findAll(@Req() req: Request) {
    return this.evidenceService.findAll(this.identity(req));
  }

  @Get(':id')
  @Permissions('evidence.read')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.evidenceService.findOne(id, this.identity(req));
  }

  @Patch(':id')
  @Permissions('evidence.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateEvidenceDto: UpdateEvidenceDto,
    @Req() req: Request,
  ) {
    return this.evidenceService.update(
      id,
      updateEvidenceDto,
      this.identity(req),
    );
  }

  @Delete(':id')
  @Permissions('evidence.manage')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.evidenceService.remove(id, this.identity(req));
  }

  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
