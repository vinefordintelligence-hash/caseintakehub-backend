import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
export class CreateDocumentDto {
  @IsUUID() case_id!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(100) document_type?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) file_url?: string;
  @IsOptional() @IsString() @MaxLength(512) file_name?: string;
  @IsOptional() @IsInt() @Min(0) file_size?: number;
  @IsOptional() @IsString() @MaxLength(100) document_status?: string;
  @IsOptional() @IsBoolean() is_client_visible?: boolean;
  @IsOptional() @IsString() @MaxLength(255) mime_type?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}
