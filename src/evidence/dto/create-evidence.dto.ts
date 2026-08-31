import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
export class CreateEvidenceDto {
  @IsUUID() case_id!: string;
  @IsString() @MinLength(1) @MaxLength(100) type!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) file_url?: string;
  @IsOptional() @IsString() @MaxLength(512) file_name?: string;
  @IsOptional() @IsInt() @Min(0) file_size?: number;
}
