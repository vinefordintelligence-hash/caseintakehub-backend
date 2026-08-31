import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AdvancePhaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
