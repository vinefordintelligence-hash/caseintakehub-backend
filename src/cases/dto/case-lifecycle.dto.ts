import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CaseLifecycleDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
