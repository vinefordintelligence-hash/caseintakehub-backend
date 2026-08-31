import {
  Body,
  Controller,
  HttpCode,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientAuthService } from './client-auth.service';
import { ClientLoginDto } from './dto/client-login.dto';
import { ResetClientPinDto } from './dto/reset-client-pin.dto';
import { UpdateClientProfileDto } from './dto/update-client-profile.dto';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { Public } from '../core/decorators/public.decorator';

@ApiTags('client-auth')
@Controller('client-auth')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class ClientAuthController {
  constructor(private readonly clientAuthService: ClientAuthService) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Client portal login — validates Case Reference ID + Client Email + 6-digit PIN together and returns a client session context bound to the authorized case. All failures return the same generic error.',
  })
  login(@Body() dto: ClientLoginDto) {
    return this.clientAuthService.login(dto);
  }

  @Post('admin/reset-pin')
  @UseGuards(SupabaseIdentityGuard)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Administrator-only: set a new client portal PIN. Only a bcrypt hash is stored and no PIN is returned.',
  })
  resetPin(@Body() dto: ResetClientPinDto, @Req() req: Request) {
    return this.clientAuthService.resetPin(
      dto.caseNumber,
      dto.newPin,
      dto.confirmPin,
      this.identity(req),
    );
  }

  @Patch('admin/profile')
  @UseGuards(SupabaseIdentityGuard)
  updateProfile(@Body() dto: UpdateClientProfileDto, @Req() req: Request) {
    const caseNumber =
      typeof (dto as UpdateClientProfileDto & { caseNumber?: unknown })
        .caseNumber === 'string'
        ? String(
            (dto as UpdateClientProfileDto & { caseNumber?: unknown })
              .caseNumber,
          )
        : '';
    return this.clientAuthService.updateProfile(
      caseNumber,
      dto,
      this.identity(req),
    );
  }

  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
