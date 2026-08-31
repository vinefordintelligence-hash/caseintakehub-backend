import {
  IsBoolean,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
export class CreateTimelineDto {
  @IsUUID() case_id!: string;
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsISO8601() event_date?: string;
  @IsOptional() @IsString() @MaxLength(100) phase?: string;
  @IsOptional() @IsString() @MaxLength(100) status?: string;
  @IsOptional() @IsBoolean() is_client_visible?: boolean;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}
