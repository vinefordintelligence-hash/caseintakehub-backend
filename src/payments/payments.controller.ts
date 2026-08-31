import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { UpdatePaymentGateDto } from './dto/update-payment-gate.dto';
import { SetCasePaymentStatusDto } from './dto/set-case-payment-status.dto';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

@ApiTags('payments')
@Controller('payments')
@UseGuards(SupabaseIdentityGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('gate')
  @ApiOperation({
    summary:
      'GLOBAL Payment Gate / Billing Settings (platform-wide, NOT per-case). Admin view.',
  })
  getPaymentGate(@Req() req: Request) {
    return this.paymentsService.getPaymentGate(this.identity(req));
  }

  @Patch('gate')
  @ApiOperation({
    summary:
      'Update the GLOBAL Payment Gate (administrators only, every change audited with previous/new value).',
  })
  updatePaymentGate(@Body() dto: UpdatePaymentGateDto, @Req() req: Request) {
    return this.paymentsService.updatePaymentGate(this.identity(req), dto);
  }

  @Get('gate/audit')
  @ApiOperation({
    summary:
      'Audit history for the global Payment Gate (administrator, timestamp, setting, previous value, new value).',
  })
  getPaymentGateAudit(@Req() req: Request) {
    return this.paymentsService.getPaymentGateAudit(this.identity(req));
  }

  @Get('cases/:caseId')
  @ApiOperation({
    summary:
      'Per-case payment record (whether this client has a legitimate charge).',
  })
  getCasePayment(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Req() req: Request,
  ) {
    return this.paymentsService.getCasePayment(caseId, this.identity(req));
  }

  @Get('cases/:caseId/client')
  @ApiOperation({
    summary:
      'Client-facing per-case payment record (sensitive fields masked; never fabricates a charge).',
  })
  getCasePaymentClient(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Req() req: Request,
  ) {
    return this.paymentsService.getCasePaymentClient(
      caseId,
      this.identity(req),
    );
  }

  @Patch('cases/:caseId')
  @ApiOperation({
    summary:
      'Set per-case payment status (administrators only; received/paid require an actual recorded payment).',
  })
  setCasePaymentStatus(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: SetCasePaymentStatusDto,
    @Req() req: Request,
  ) {
    return this.paymentsService.setCasePaymentStatus(
      caseId,
      this.identity(req),
      dto,
    );
  }
  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
