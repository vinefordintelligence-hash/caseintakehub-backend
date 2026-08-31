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
import { KycService } from './kyc.service';

@Controller('kyc')
@UseGuards(SupabaseIdentityGuard)
export class KycController {
  constructor(private readonly kyc: KycService) {}
  @Get('mine') mine(@Req() req: Request) {
    return this.kyc.mine(this.identity(req));
  }
  @Post('start') start(
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.kyc.start(body, this.identity(req));
  }
  @Post('submit') submit(@Req() req: Request) {
    return this.kyc.submit(this.identity(req));
  }
  @Post('requirements/:id/upload') upload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.kyc.upload(id, body, this.identity(req));
  }
  @Get('reviews') list(@Req() req: Request) {
    return this.kyc.list(this.identity(req));
  }
  @Get(':id') detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.kyc.detail(id, this.identity(req));
  }
  @Patch(':id/review') review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.kyc.review(id, body, this.identity(req));
  }
  @Patch('documents/:id/review') reviewDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.kyc.reviewDocument(id, body, this.identity(req));
  }
  @Get('documents/:id/download') async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.kyc.download(id, this.identity(req));
    res.setHeader('content-type', file.mimeType);
    res.setHeader(
      'content-disposition',
      `attachment; filename="${file.fileName}"`,
    );
    res.setHeader('cache-control', 'private, no-store');
    res.send(file.file);
  }
  private identity(req: Request) {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
