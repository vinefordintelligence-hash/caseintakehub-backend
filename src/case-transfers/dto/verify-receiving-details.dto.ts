import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class VerifyReceivingDetailsDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  verified: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
