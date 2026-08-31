import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  VINEFORD_USER_ROLES,
  VinefordUserRole,
} from '../../identity/supabase-identity.service';

export class UserListQueryDto {
  @IsOptional() @IsIn(VINEFORD_USER_ROLES) role?: VinefordUserRole;
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 50;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}
