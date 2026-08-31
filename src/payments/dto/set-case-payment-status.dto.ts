import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export enum CasePaymentStatusEnum {
  not_required = 'not_required',
  required = 'required',
  pending = 'pending',
  received = 'received',
  failed = 'failed',
  cancelled = 'cancelled',
  waived = 'waived',
  paid = 'paid',
}

export class SetCasePaymentStatusDto {
  @ApiProperty({
    enum: CasePaymentStatusEnum,
    description:
      'Per-case payment state. received/paid require an actual recorded payment (invoice_id of a real invoice with an existing payments row).',
  })
  @IsEnum(CasePaymentStatusEnum)
  status: CasePaymentStatusEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payment_method?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  due_date?: string;

  @ApiPropertyOptional({
    description:
      'Required for received/paid: the real invoice the payment settles.',
  })
  @IsOptional()
  @IsUUID()
  invoice_id?: string;

  @ApiPropertyOptional({
    description: 'Actual payment reference number.',
  })
  @IsOptional()
  @IsString()
  reference_number?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  client_visible?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
