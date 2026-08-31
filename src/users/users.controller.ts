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
  Query,
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { Permissions } from '../core/decorators/permissions.decorator';
import { UserListQueryDto } from './dto/user-list-query.dto';

@Controller('users')
@UseGuards(SupabaseIdentityGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Permissions('users.manage')
  create(@Body() dto: CreateUserDto, @Req() req: Request) {
    return this.usersService.create(dto, this.identity(req));
  }

  @Get()
  @Permissions('users.read')
  findAll(@Query() query: UserListQueryDto, @Req() req: Request) {
    return this.usersService.findAll(this.identity(req), query);
  }

  @Get(':id/activity')
  @Permissions('users.read')
  activity(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.usersService.activity(id, this.identity(req));
  }

  @Get(':id')
  @Permissions('users.read')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.usersService.findOne(id, this.identity(req));
  }

  @Patch(':id')
  @Permissions('users.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ) {
    return this.usersService.update(id, dto, this.identity(req));
  }

  @Delete(':id')
  @Permissions('users.manage')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.usersService.remove(id, this.identity(req));
  }

  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
