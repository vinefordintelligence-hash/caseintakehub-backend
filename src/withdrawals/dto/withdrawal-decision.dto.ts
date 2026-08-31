import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export type WithdrawalDecisionType = 'approve' | 'reject' | 'needs_information';

export class WithdrawalDecisionDto {
  @ApiProperty({
    description:
      'Admin decision. Approve NEVER executes a real financial transfer (SANDBOX / DEMO only).',
    enum: ['approve', 'reject', 'needs_information'],
  })
  @IsIn(['approve', 'reject', 'needs_information'])
  decision: WithdrawalDecisionType;

  @ApiPropertyOptional({
    description:
      'Required for reject (admin reason, stored and client-visible) and needs_information (message to the client).',
    example: 'Insufficient documentation for the beneficiary account.',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: 'Internal admin note (never shown to the client).',
    example: 'Verified in control room review.',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
