import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class IssueHandoffDto {
  @ApiPropertyOptional({
    description:
      'The active client action to unlock. Defaults to the most recently activated client-visible action.',
    example: '35953304-8b6e-4cc0-a824-cf6d8ed5748e',
  })
  @IsOptional()
  @IsUUID()
  action_id?: string;

  @ApiPropertyOptional({
    description:
      'Human-readable note recorded alongside the handoff (for audit).',
    example: 'Approving Phase 6 for Gayl Creel',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
