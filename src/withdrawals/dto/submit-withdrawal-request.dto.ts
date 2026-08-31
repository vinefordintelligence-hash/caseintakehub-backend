import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class SubmitWithdrawalRequestDto {
  @ApiProperty({
    description:
      'Case to submit the authorized withdrawal request for (Phase 6).',
    example: '7b2abe2a-9312-42b8-a48d-408fd1771b77',
  })
  @IsUUID()
  case_id: string;

  @ApiProperty({
    description:
      'Phase 6 handoff token obtained from the workflow handoff issue endpoint. The token signature AND the live handoff grant are both re-validated server-side.',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJncmFudF9pZCI6InV1aWQifQ.signature',
  })
  @IsString()
  @MinLength(16)
  handoff_token: string;

  @ApiProperty({
    description:
      'Requested amount. SANDBOX / DEMO — this is simulated functionality; no real funds are involved.',
    example: 114000,
  })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({
    description: 'Currency code.',
    example: 'USD',
    default: 'USD',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({
    description: 'Requested method, e.g. bank_transfer, ach, wire.',
    example: 'bank_transfer',
  })
  @IsOptional()
  @IsString()
  requested_method?: string;

  @ApiPropertyOptional({
    description: 'Beneficiary name on the receiving account.',
    example: 'Gayl M. Chenoweth',
  })
  @IsOptional()
  @IsString()
  beneficiary_name?: string;

  @ApiPropertyOptional({
    description:
      'Receiving account number (stored; masked to the client in client views).',
    example: '003288471199',
  })
  @IsOptional()
  @IsString()
  account_number?: string;

  @ApiPropertyOptional({
    description: 'Account type.',
    example: 'savings',
  })
  @IsOptional()
  @IsString()
  account_type?: string;

  @ApiPropertyOptional({
    description: 'Receiving institution routing number.',
    example: '021000021',
  })
  @IsOptional()
  @IsString()
  routing_number?: string;

  @ApiPropertyOptional({
    description: 'Client note accompanying the request.',
    example: 'Please process',
  })
  @IsOptional()
  @IsString()
  client_note?: string;
}
