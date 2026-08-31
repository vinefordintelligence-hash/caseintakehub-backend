import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
export class CreateEntityDto {
  @IsUUID() case_id!: string;
  @IsIn([
    'person',
    'organization',
    'wallet',
    'account',
    'email',
    'phone',
    'domain',
    'ip',
    'other',
  ])
  entity_type!: string;
  @IsString() @MinLength(1) @MaxLength(300) display_name!: string;
  @IsOptional() @IsString() @MaxLength(500) normalized_value?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}
export class CreateRelationshipDto {
  @IsUUID() case_id!: string;
  @IsUUID() source_entity_id!: string;
  @IsUUID() target_entity_id!: string;
  @IsString() @MinLength(1) @MaxLength(120) relationship_type!: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) confidence?: number;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}
