import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
export class CreateInvestigationDto {
  @IsUUID() case_id!: string;
  @IsString() @MinLength(1) @MaxLength(240) title!: string;
  @IsString() @MinLength(1) @MaxLength(20000) narrative!: string;
  @IsOptional() @IsString() @MaxLength(2000) source?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) confidence?: number;
}
