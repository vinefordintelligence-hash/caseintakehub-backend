/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { TransactionAuthorizationService } from './transaction-authorization.service';
@Controller('transaction-authorization')
@UseGuards(SupabaseIdentityGuard)
export class TransactionAuthorizationController {
  constructor(private readonly service: TransactionAuthorizationService) {}
  @Get('cases/:caseId') get(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Req() req: Request,
  ) {
    return this.service.get(caseId, this.identity(req));
  }
  @Post('cases/:caseId') create(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.service.create(caseId, body, this.identity(req));
  }
  @Post('cases/:caseId/voided-check') upload(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.service.upload(caseId, body, this.identity(req));
  }
  @Patch('cases/:caseId/voided-check/review') review(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.service.review(caseId, body, this.identity(req));
  }
  @Patch('cases/:caseId/authorization') authorize(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.service.authorize(caseId, body, this.identity(req));
  }
  @Post('cases/:caseId/payment-receipt') uploadPaymentReceipt(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.service.uploadPaymentReceipt(caseId, body, this.identity(req));
  }
  @Patch('cases/:caseId/payment-receipt/review') reviewPaymentReceipt(
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
