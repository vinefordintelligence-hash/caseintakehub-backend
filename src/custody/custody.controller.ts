import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Permissions } from '../core/decorators/permissions.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { CustodyService } from './custody.service';
import { CreateCustodyEventDto } from './dto/create-custody-event.dto';
@Controller('evidence/:evidenceId/custody')
@Roles('admin', 'super_admin', 'investigator', 'staff')
export class CustodyController {
  constructor(private readonly custody: CustodyService) {}
  @Get() @Permissions('evidence.read') list(
    @Param('evidenceId', ParseUUIDPipe) id: string,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.custody.list(id, identity);
  }
  @Post() @Permissions('evidence.manage') create(
    @Param('evidenceId', ParseUUIDPipe) id: string,
    @Body() dto: CreateCustodyEventDto,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.custody.create({ ...dto, evidence_id: id }, identity);
  }
}
