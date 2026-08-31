import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export enum AdminReviewOutcome {
  approved = 'approved',
  rejected = 'rejected',
  needs_information = 'needs_information',
}

export class AdminReviewRequirementDto {
  @ApiProperty({
    enum: AdminReviewOutcome,
    description:
      'Admin review decision. approved -> VERIFIED + PHASE 5 (unlocks PHASE 6). rejected -> REJECTED, PHASE 5 never reached. needs_information -> returns the case to the required-information workflow.',
  })
  @IsEnum(AdminReviewOutcome)
  outcome: AdminReviewOutcome;

  @ApiPropertyOptional({
    description:
      'Reviewer note recorded against the requirement, transfer and audit trail.',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'Submitted document being reviewed.' })
  @IsOptional()
  @IsUUID()
  document_id?: string;
}
