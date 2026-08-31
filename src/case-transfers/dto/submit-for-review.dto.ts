import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SubmitForReviewDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
