/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { Idempotent } from '../core/idempotency/idempotent.decorator';
import { Permissions } from '../core/decorators/permissions.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { GatewayRequest } from '../core/gateway/gateway-request';
import { TransactionAuthorizationService } from './transaction-authorization.service';
import { UpdatePaymentAddressDto } from './dto/update-payment-address.dto';
@ApiTags('transaction-authorization')
@Controller('transaction-authorization')
@UseGuards(SupabaseIdentityGuard)
export class TransactionAuthorizationController {
  constructor(private readonly service: TransactionAuthorizationService) {}
  @Get('config/payment-gate')
  @Roles('admin', 'super_admin')
  @Permissions('transaction_authorization.read')
  @ApiOperation({ summary: 'Read the global TAR payment configuration' })
  getPaymentConfig(@Req() req: Request) {
    return this.service.getPaymentConfig(this.identity(req));
  }
  @Patch('config/payment-gate/address')
  @Roles('admin', 'super_admin')
  @Permissions('transaction_authorization.manage')
  @ApiOperation({
    summary: 'Update only the global TAR Bitcoin payment address',
  })
  updatePaymentAddress(
    @Body() dto: UpdatePaymentAddressDto,
    @Req() req: Request,
  ) {
    return this.service.updatePaymentAddress(
      dto.payment_address,
      this.identity(req),
      (req as GatewayRequest).vfRequestId,
      {
        feePurpose: dto.fee_purpose,
        feeBreakdown: dto.fee_breakdown,
      },
    );
  }
  @Get('cases/:caseId') async get(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Req() req: Request,
  ) {
    const result = await this.service.get(caseId, this.identity(req));
    if (!result) {
      throw new NotFoundException('Authorization review not found for this case.');
    }
    return result;
  }
  @Post('cases/:caseId')
  @Idempotent()
  create(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.service.create(caseId, body, this.identity(req));
  }
  @Post('cases/:caseId/voided-check')
  @Idempotent()
  upload(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.service.upload(caseId, body, this.identity(req));
  }
  @Patch('cases/:caseId/voided-check/review')
  @Idempotent()
  review(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.service.review(caseId, body, this.identity(req));
  }
  @Patch('cases/:caseId/authorization')
  @Idempotent()
  authorize(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.service.authorize(caseId, body, this.identity(req));
  }
  @Post('cases/:caseId/payment-receipt')
  @Idempotent()
  uploadPaymentReceipt(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.service.uploadPaymentReceipt(caseId, body, this.identity(req));
  }
  @Patch('cases/:caseId/payment-receipt/review')
  @Idempotent()
  reviewPaymentReceipt(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.service.reviewPaymentReceipt(caseId, body, this.identity(req));
  }
  @Get('cases/:caseId/payment-receipt/download')
  async downloadPaymentReceipt(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const f = await this.service.downloadPaymentReceipt(
      caseId,
      this.identity(req),
    );
    res.setHeader('content-type', f.mimeType);
    res.setHeader(
      'content-disposition',
      `attachment; filename="${f.fileName}"`,
    );
    res.setHeader('cache-control', 'private, no-store');
    res.send(f.file);
  }
  @Get('cases/:caseId/voided-check/download') async download(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const f = await this.service.download(caseId, this.identity(req));
    res.setHeader('content-type', f.mimeType);
    res.setHeader(
      'content-disposition',
      `attachment; filename="${f.fileName}"`,
    );
    res.setHeader('cache-control', 'private, no-store');
    res.send(f.file);
  }
  private identity(req: Request) {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
