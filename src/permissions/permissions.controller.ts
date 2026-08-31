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
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { Roles } from '../core/decorators/roles.decorator';

@Controller('permissions')
@UseGuards(SupabaseIdentityGuard)
@Roles('admin', 'super_admin')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Post()
  @Roles('super_admin')
  create(@Body() dto: CreatePermissionDto, @Req() req: Request) {
    return this.permissionsService.create(dto, this.identity(req));
  }

  @Get()
  findAll(@Req() req: Request) {
    return this.permissionsService.findAll(this.identity(req));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: Request) {
    return this.permissionsService.findOne(id, this.identity(req));
  }

  @Get(':id/history')
  @Roles('super_admin')
  history(@Param('id') id: string, @Req() req: Request) {
    return this.permissionsService.history(id, this.identity(req));
  }

  @Patch(':id')
  @Roles('super_admin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePermissionDto,
    @Req() req: Request,
  ) {
    return this.permissionsService.update(id, dto, this.identity(req));
  }

  @Delete(':id')
  @Roles('super_admin')
  remove(@Param('id') id: string, @Req() req: Request) {
    return this.permissionsService.remove(id, this.identity(req));
  }

  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
