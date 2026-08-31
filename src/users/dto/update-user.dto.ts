import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  VINEFORD_USER_ROLES,
  VinefordUserRole,
} from '../../identity/supabase-identity.service';

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsIn(VINEFORD_USER_ROLES) role?: VinefordUserRole;
  @IsOptional() @IsBoolean() is_active?: boolean;
}
