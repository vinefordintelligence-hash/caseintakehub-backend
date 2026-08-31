import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SearchQueryDto {
  @IsString() @MinLength(2) @MaxLength(160) q!: string;
  @IsOptional() @IsIn(['all', 'case', 'client', 'document', 'evidence']) type:
    'all' | 'case' | 'client' | 'document' | 'evidence' = 'all';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30;
}
