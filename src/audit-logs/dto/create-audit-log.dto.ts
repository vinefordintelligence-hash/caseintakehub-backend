import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateAuditLogDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  user_id?: string;

  @IsString()
  @MaxLength(100)
  action!: string;

  @IsString()
  @MaxLength(100)
  resource_type!: string;

  @IsString()
  @MaxLength(100)
  resource_id!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  case_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  changes?: Record<string, unknown> | null;
}
