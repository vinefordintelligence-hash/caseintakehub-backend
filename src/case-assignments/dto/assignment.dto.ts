import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateAssignmentDto {
  @IsUUID() case_id!: string;
  @IsUUID() app_user_id!: string;
  @IsString() @MinLength(2) @MaxLength(80) assignment_role!: string;
  @IsIn(['primary', 'supporting']) assignment_kind!: 'primary' | 'supporting';
  @IsOptional() @IsDateString() assignment_date?: string;
  @IsOptional() @IsString() @MaxLength(2000) internal_note?: string;
}

export class ReassignAssignmentDto {
  @IsUUID() app_user_id!: string;
  @IsOptional() @IsString() @MaxLength(80) assignment_role?: string;
  @IsOptional()
  @IsIn(['primary', 'supporting'])
  assignment_kind?: 'primary' | 'supporting';
  @IsString() @MinLength(2) @MaxLength(1000) reason!: string;
  @IsOptional() @IsString() @MaxLength(2000) internal_note?: string;
}

export class RemoveAssignmentDto {
  @IsString() @MinLength(2) @MaxLength(1000) reason!: string;
}
