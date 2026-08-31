import {
  IsArray,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateIntakeDto {
  @IsUUID() organization_id!: string;
  @IsEmail() @MaxLength(320) email!: string;
  @IsOptional() @IsString() @MaxLength(120) category?: string;
  @IsOptional() @IsString() @MaxLength(10000) incident_description?: string;
  @IsOptional() @IsIn(['low', 'normal', 'high', 'urgent']) urgency?: string;
}

export class SubmitPublicIntakeDto {
  @IsString() @MinLength(1) @MaxLength(120) first_name!: string;
  @IsString() @MinLength(1) @MaxLength(120) last_name!: string;
  @IsEmail() @MaxLength(320) email!: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsString() @MinLength(1) @MaxLength(120) country!: string;
  @IsOptional() @IsString() @MaxLength(200) company?: string;
  @IsArray() @IsString({ each: true }) services!: string[];
  @IsOptional() @IsString() @MaxLength(120) role?: string;
  @IsOptional() @IsString() @MaxLength(10000) situation?: string;
  @IsOptional() @IsString() @MaxLength(40) existing_client?: string;
  @IsOptional() @IsString() @MaxLength(120) financial_loss?: string;
  @IsOptional() @IsString() @MaxLength(120) contact_method?: string;
  @IsOptional() @IsString() @MaxLength(120) existing_case_reference?: string;
  @IsOptional() @IsIn(['low', 'normal', 'high', 'urgent']) urgency?: string;
  @IsOptional() @IsObject() assessment_answers?: Record<string, unknown>;
}

export class ResumeIntakeDto {
  @IsUUID() intake_id!: string;
  @IsString() @MinLength(40) @MaxLength(200) token!: string;
}

export class UpdateIntakeDraftDto extends ResumeIntakeDto {
  @IsOptional() @IsString() @MaxLength(120) category?: string;
  @IsOptional() @IsString() @MaxLength(10000) incident_description?: string;
  @IsOptional() @IsIn(['low', 'normal', 'high', 'urgent']) urgency?: string;
}

export class ReviewIntakeDto {
  @IsIn(['under_review', 'accepted', 'rejected']) status!: string;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
