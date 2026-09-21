import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Idempotent } from '../core/idempotency/idempotent.decorator';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { PaymentOperationsService } from './payment-operations.service';

@Controller('payment-operations')
export class PaymentOperationsController {
  constructor(private readonly service: PaymentOperationsService) {}

  @Post()
  @Idempotent()
  create(@Body() body: Record<string, unknown>, @Req() req: Request) {
    return this.service.createRequirement(body, this.identity(req));
  }

  @Get('cases/:caseId')
  list(@Param('caseId', ParseUUIDPipe) caseId: string, @Req() req: Request) {
    return this.service.listForCase(caseId, this.identity(req));
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.service.getRequirement(id, this.identity(req));
  }

  @Patch(':id/authorize')
  @Idempotent()
  authorize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.service.authorize(
      id,
      this.identity(req),
      typeof body.reason === 'string' ? body.reason : '',
    );
  }

  @Patch(':id/issue')
  @Idempotent()
  issue(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.service.issue(id, this.identity(req));
  }

  @Patch(':id/cancel')
  @Idempotent()
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.service.cancel(
      id,
      this.identity(req),
      typeof body.reason === 'string' ? body.reason : '',
    );
  }

  @Patch(':id/expire')
  @Idempotent()
  expire(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.service.expire(id, this.identity(req));
  }

  @Patch(':id/dispute')
  @Idempotent()
  dispute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.service.markDisputed(
      id,
      this.identity(req),
      typeof body.reason === 'string' ? body.reason : '',
    );
  }

  @Patch(':id/dispute/resolve')
  @Idempotent()
  resolveDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.service.resolveDispute(
      id,
      this.identity(req),
      typeof body.reason === 'string' ? body.reason : '',
    );
  }

  @Patch(':id/refund')
  @Idempotent()
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const state =
      body.state === 'REFUND_PENDING' ||
      body.state === 'PARTIALLY_REFUNDED' ||
      body.state === 'REFUNDED'
        ? body.state
        : 'REFUND_PENDING';
    return this.service.recordRefundState(
      id,
      this.identity(req),
      state,
      typeof body.reason === 'string' ? body.reason : '',
      typeof body.refundedAmount === 'string' ? body.refundedAmount : undefined,
    );
  }

  @Post(':id/authoritative-payment/:paymentId')
  @Idempotent()
  recordPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Req() req: Request,
  ) {
    return this.service.recordAuthoritativePayment(
      id,
      paymentId,
      this.identity(req),
    );
  }

  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
