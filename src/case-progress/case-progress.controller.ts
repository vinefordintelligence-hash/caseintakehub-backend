import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { CaseProgressService } from './case-progress.service';
import { UpdateCaseProgressDto } from './dto/update-case-progress.dto';

@Controller('case-progress')
@UseGuards(SupabaseIdentityGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class CaseProgressController {
  constructor(private readonly service: CaseProgressService) {}
  @Get(':caseId/client-workspace/:module') workspace(
    @Param('caseId') caseId: string,
    @Param('module') module: string,
    @Req() req: Request,
  ) {
    return this.service.clientWorkspace(caseId, module, this.identity(req));
  }
  @Get(':caseId') get(@Param('caseId') caseId: string, @Req() req: Request) {
    return this.service.get(caseId, this.identity(req));
  }
  @Patch(':caseId') update(
    @Param('caseId') caseId: string,
    @Body() dto: UpdateCaseProgressDto,
    @Req() req: Request,
  ) {
    return this.service.update(caseId, dto, this.identity(req));
  }
  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
