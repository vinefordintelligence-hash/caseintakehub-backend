import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import {
  VINEFORD_USER_ROLES,
  VinefordUserRole,
} from '../../identity/supabase-identity.service';

export class CreateUserDto {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsEmail() @MaxLength(320) email!: string;
  @IsIn(VINEFORD_USER_ROLES) role!: VinefordUserRole;
}
