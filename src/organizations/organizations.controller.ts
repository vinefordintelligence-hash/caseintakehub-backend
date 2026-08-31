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
} from '@nestjs/common';
import { Request } from 'express';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { Permissions } from '../core/decorators/permissions.decorator';

@Controller('organizations')
@UseGuards(SupabaseIdentityGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @Permissions('organizations.manage')
  create(@Body() dto: CreateOrganizationDto, @Req() req: Request) {
    return this.organizationsService.create(dto, this.identity(req));
  }

  @Get()
  @Permissions('organizations.read')
  findAll(@Req() req: Request) {
    return this.organizationsService.findAll(this.identity(req));
  }

  @Get(':id')
  @Permissions('organizations.read')
  findOne(@Param('id') id: string, @Req() req: Request) {
    return this.organizationsService.findOne(id, this.identity(req));
  }

  @Patch(':id')
  @Permissions('organizations.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
    @Req() req: Request,
  ) {
    return this.organizationsService.update(id, dto, this.identity(req));
  }

  @Delete(':id')
  @Permissions('organizations.manage')
  remove(@Param('id') id: string, @Req() req: Request) {
    return this.organizationsService.remove(id, this.identity(req));
  }

  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
