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
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

@Controller('roles')
@UseGuards(SupabaseIdentityGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  create(@Body() dto: CreateRoleDto, @Req() req: Request) {
    return this.rolesService.create(dto, this.identity(req));
  }

  @Get()
  findAll(@Req() req: Request) {
    return this.rolesService.findAll(this.identity(req));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: Request) {
    return this.rolesService.findOne(id, this.identity(req));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @Req() req: Request,
  ) {
    return this.rolesService.update(id, dto, this.identity(req));
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: Request) {
    return this.rolesService.remove(id, this.identity(req));
  }

  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
