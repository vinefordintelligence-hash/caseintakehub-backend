import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { LedgerService } from './ledger.service';
@Controller('ledger')
@Roles('admin', 'super_admin', 'financial_analyst')
export class LedgerController {
  constructor(private readonly service: LedgerService) {}
  @Get() findAll(@CurrentUser() i: VerifiedIdentity) {
    return this.service.findAll(i);
  }
  @Get(':id') findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() i: VerifiedIdentity,
  ) {
    return this.service.findOne(id, i);
  }
  @Post() create() {
    return this.service.create();
  }
  @Patch(':id') update() {
    return this.service.update();
  }
  @Delete(':id') remove() {
    return this.service.remove();
  }
}
