import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

export class UpdatePaymentGateDto {
  @ApiPropertyOptional({
    description:
      'GLOBAL payment gate on/off. Enabling it does NOT create any per-case obligation.',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Whether the gate presentation is visible to clients.',
  })
  @IsOptional()
  @IsBoolean()
  client_visible?: boolean;

  @ApiPropertyOptional({ example: 'Service Fee' })
  @IsOptional()
  @IsString()
  payment_title?: string;

  @ApiPropertyOptional({
    example: 'Verified client service fee.',
  })
  @IsOptional()
  @IsString()
  payment_description?: string;

  @ApiPropertyOptional({ example: 150 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: ['card', 'bank'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  payment_methods?: string[];

  @ApiPropertyOptional({
    description: 'Due date behavior, e.g. {"offset_days":14}.',
  })
  @IsOptional()
  @IsObject()
  due_date_behavior?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Invoice/reference behavior, e.g. {"prefix":"INV-","source":"global"}.',
  })
  @IsOptional()
  @IsObject()
  invoice_reference_behavior?: Record<string, unknown>;
}
