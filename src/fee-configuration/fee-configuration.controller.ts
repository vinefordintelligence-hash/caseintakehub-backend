import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FeeConfigurationService } from './fee-configuration.service';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { Roles } from '../core/decorators/roles.decorator';
import { Request } from 'express';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

@Controller('fee-configuration')
@UseGuards(SupabaseIdentityGuard)
export class FeeConfigurationController {
  constructor(private readonly service: FeeConfigurationService) {}

  @Get()
  @Roles('admin', 'super_admin')
  list(@Req() req: Request) {
    return this.service.listDefinitions(this.identity(req));
  }

  @Get(':id')
  @Roles('admin', 'super_admin')
  get(@Param('id') id: string, @Req() req: Request) {
    return this.service.getDefinition(id, this.identity(req).organizationId);
  }

  @Post()
  @Roles('admin', 'super_admin')
  create(@Body() dto: any, @Req() req: Request) {
    return this.service.create(dto, this.identity(req));
  }

  @Patch(':id')
  @Roles('admin', 'super_admin')
  update(@Param('id') id: string, @Body() dto: any, @Req() req: Request) {
    return this.service.updateDefinition(
      id,
      this.identity(req).organizationId,
      dto,
      this.identity(req).actorId,
    );
  }

  @Post(':definitionId/components')
  @Roles('admin', 'super_admin')
  addComponent(@Param('definitionId') definitionId: string, @Body() dto: any) {
    return this.service.addComponent(definitionId, dto);
  }

  @Patch(':definitionId/components/:componentId')
  @Roles('admin', 'super_admin')
  updateComponent(
    @Param('definitionId') definitionId: string,
    @Param('componentId') componentId: string,
    @Body() dto: any,
    @Req() req: Request,
  ) {
    return this.service.updateComponent(
      definitionId,
      componentId,
      this.identity(req).organizationId,
      dto,
    );
  }

  private identity(req: Request) {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
