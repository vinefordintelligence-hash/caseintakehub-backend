import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateClientProfileDto {
  @IsString() @MaxLength(80) caseNumber!: string;
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsEmail() @MaxLength(320) email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(240) address?: string;
  @IsOptional() @IsString() @MaxLength(120) city?: string;
  @IsOptional() @IsString() @MaxLength(120) state?: string;
  @IsOptional() @IsString() @MaxLength(24) zip_code?: string;
  @IsOptional() @IsString() @MaxLength(120) country?: string;
}
