import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCaseDto {
  @ApiProperty({ example: 'DIGITAL FORENSIC ASSESSMENT/ INVESTIGATION' })
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @ApiProperty()
  @IsUUID()
  client_id: string;

  @ApiProperty()
  @IsUUID()
  organization_id: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigned_to?: string;
}
