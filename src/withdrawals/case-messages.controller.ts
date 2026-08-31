import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { WithdrawalsService } from './withdrawals.service';
import type { WorkflowView } from '../workflow/workflow.service';
import { SendCaseMessageDto } from './dto/send-case-message.dto';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { Permissions } from '../core/decorators/permissions.decorator';

@ApiTags('cases')
@Controller('cases')
@UseGuards(SupabaseIdentityGuard)
export class CaseMessagesController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Get(':caseId/messages')
  @Permissions('messages.read')
  @ApiOperation({
    summary:
      'Case-scoped secure messaging thread (reuses the existing case messaging store).',
  })
  @ApiQuery({ name: 'view', required: false, enum: ['admin', 'client'] })
  getMessages(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Query('view') view?: WorkflowView,
    @Req() req?: Request,
  ) {
    const identity = this.identity(req!);
    if (identity.role === 'client') {
      if (identity.caseId !== caseId)
        throw new ForbiddenException('case access denied');
      view = 'client';
    }
    return this.withdrawalsService.getMessages(
      caseId,
      view ?? 'admin',
      identity.actorId,
    );
  }

  @Post(':caseId/messages')
  @Permissions('messages.send')
  @ApiOperation({
    summary:
      'Send a message within the authenticated case context (client or administrator on the case).',
  })
  sendMessage(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: SendCaseMessageDto,
    @Req() req: Request,
  ) {
    const identity = this.identity(req);
    if (identity.role === 'client' && identity.caseId !== caseId)
      throw new ForbiddenException('case access denied');
    return this.withdrawalsService.sendMessage(
      caseId,
      identity.actorId,
      dto.content,
    );
  }

  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
