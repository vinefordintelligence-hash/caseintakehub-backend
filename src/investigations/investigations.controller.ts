import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Permissions } from '../core/decorators/permissions.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { UpdateInvestigationDto } from './dto/update-investigation.dto';
import { InvestigationsService } from './investigations.service';
@Controller('investigations')
@Roles('admin', 'super_admin', 'investigator', 'staff')
export class InvestigationsController {
  constructor(private readonly service: InvestigationsService) {}
  @Post() @Permissions('cases.update') create(
    @Body() d: CreateInvestigationDto,
    @CurrentUser() i: VerifiedIdentity,
  ) {
    return this.service.create(d, i);
  }
  @Get() @Permissions('cases.read') findAll(
    @CurrentUser() i: VerifiedIdentity,
  ) {
    return this.service.findAll(i);
  }
  @Get(':id') @Permissions('cases.read') findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() i: VerifiedIdentity,
  ) {
    return this.service.findOne(id, i);
  }
  @Patch(':id') @Permissions('cases.update') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: UpdateInvestigationDto,
    @CurrentUser() i: VerifiedIdentity,
  ) {
    return this.service.update(id, d, i);
  }
  @Delete(':id') @Permissions('cases.update') remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() i: VerifiedIdentity,
  ) {
    return this.service.remove(id, i);
  }
}
