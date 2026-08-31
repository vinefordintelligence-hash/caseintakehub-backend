import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RevokeHandoffDto {
  @ApiPropertyOptional({
    description: 'Optional note explaining why the handoff was revoked.',
    example: 'Case moved back to verification review.',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
