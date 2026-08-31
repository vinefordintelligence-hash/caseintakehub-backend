import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
export class CreateInvoiceDto {
  @IsUUID() case_id!: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;
  @IsOptional() @IsString() @MaxLength(80) invoice_number?: string;
  @IsOptional()
  @IsIn(['draft', 'sent', 'overdue', 'cancelled'])
  status?: string;
  @IsOptional() @IsISO8601() due_date?: string;
}
