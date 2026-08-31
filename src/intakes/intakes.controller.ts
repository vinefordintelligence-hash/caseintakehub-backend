import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Public } from '../core/decorators/public.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import {
  CreateIntakeDto,
  ResumeIntakeDto,
  ReviewIntakeDto,
  SubmitPublicIntakeDto,
  UpdateIntakeDraftDto,
} from './dto/intake.dto';
import { IntakesService } from './intakes.service';

@Controller('intakes')
export class IntakesController {
  constructor(private readonly intakes: IntakesService) {}
  @Post() @Public() create(@Body() dto: CreateIntakeDto) {
    return this.intakes.create(dto);
  }
  @Post('public-submit') @Public() publicSubmit(
    @Body() dto: SubmitPublicIntakeDto,
  ) {
    return this.intakes.publicSubmit(dto);
  }
  @Post('resume') @Public() resume(@Body() dto: ResumeIntakeDto) {
    return this.intakes.resume(dto);
  }
  @Patch('draft') @Public() update(@Body() dto: UpdateIntakeDraftDto) {
    return this.intakes.update(dto);
  }
  @Post('submit') @Public() submit(@Body() dto: ResumeIntakeDto) {
    return this.intakes.submit(dto);
  }
  @Get() @Roles('admin', 'super_admin', 'investigator', 'staff') list(
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.intakes.list(identity);
  }
  @Get(':id') @Roles('admin', 'super_admin', 'investigator', 'staff') detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.intakes.detail(id, identity);
  }
  @Patch(':id/review') @Roles('admin', 'super_admin') review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewIntakeDto,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.intakes.review(id, dto, identity);
  }
  @Post(':id/convert') @Roles('admin', 'super_admin') convert(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.intakes.convert(id, identity);
  }
}
