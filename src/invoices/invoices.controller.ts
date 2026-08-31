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
import { Roles } from '../core/decorators/roles.decorator';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoicesService } from './invoices.service';
@Controller('invoices')
@Roles('admin', 'super_admin', 'financial_analyst')
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}
  @Post() create(
    @Body() d: CreateInvoiceDto,
    @CurrentUser() i: VerifiedIdentity,
  ) {
    return this.service.create(d, i);
  }
  @Get() findAll(@CurrentUser() i: VerifiedIdentity) {
    return this.service.findAll(i);
  }
  @Get(':id') findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() i: VerifiedIdentity,
  ) {
    return this.service.findOne(id, i);
  }
  @Patch(':id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: UpdateInvoiceDto,
    @CurrentUser() i: VerifiedIdentity,
  ) {
    return this.service.update(id, d, i);
  }
  @Delete(':id') remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() i: VerifiedIdentity,
  ) {
    return this.service.remove(id, i);
  }
}
