import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateCaseProgressDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  investigation_progress_percent?: number;

  @IsOptional()
  @IsUUID('4')
  lead_investigator_user_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lead_investigator_selection?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  estimated_next_step?: string | null;

  @IsOptional()
  @IsIn(['low', 'normal', 'high', 'urgent'])
  priority?: string | null;

  @IsOptional()
  @IsBoolean()
  payment_gate_enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  payment_gate_title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  payment_gate_description?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? Number(value) : value))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  payment_gate_amount?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  payment_gate_currency?: string;

  @IsOptional()
  @IsBoolean()
  payment_gate_blocks_progress?: boolean;

  @IsOptional()
  @IsIn(['NOT_REQUIRED', 'REQUIRED', 'PENDING', 'WAIVED', 'CANCELLED', 'PAID'])
  payment_gate_status?: string;

  @IsOptional()
  @IsBoolean()
  supporting_verification_required?: boolean;

  @IsOptional()
  @IsIn(['VOIDED_CHECK', 'DIVORCE_DOCUMENT', 'EITHER'])
  accepted_supporting_document?: string;
}
