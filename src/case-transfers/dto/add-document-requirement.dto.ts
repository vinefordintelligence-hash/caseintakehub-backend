import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID } from 'class-validator';

export class AddDocumentRequirementDto {
  @ApiProperty({ example: 'certified_divorce_decree' })
  @IsString()
  key: string;

  @ApiProperty({ example: 'Certified Divorce Decree / Divorce Judgment' })
  @IsString()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'legal' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  transfer_id?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sort_order?: number;
}
