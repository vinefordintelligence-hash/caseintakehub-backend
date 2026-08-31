import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export enum RequirementStatusEnum {
  submitted = 'submitted',
  under_review = 'under_review',
}

export class SetRequirementStatusDto {
  @ApiProperty({
    enum: RequirementStatusEnum,
    description:
      'Requirement lifecycle transition. submitted = client upload hand-off; under_review = admin begins review. VERIFIED / REJECTED / NEEDS_INFORMATION are only reachable through the admin review endpoint.',
  })
  @IsEnum(RequirementStatusEnum)
  status: RequirementStatusEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  document_id?: string;
}
