import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTaskDto {
  @IsUUID() case_id!: string;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsIn(['low', 'normal', 'high', 'urgent']) priority?: string;
  @IsOptional() @IsUUID() assigned_to?: string;
  @IsOptional() @IsBoolean() client_visible?: boolean;
  @IsOptional() @IsISO8601() due_at?: string;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) depends_on?: string[];
}
