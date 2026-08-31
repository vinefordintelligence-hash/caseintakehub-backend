import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
export class CreateCustodyEventDto {
  @IsUUID() evidence_id!: string;
  @IsIn([
    'registered',
    'accessed',
    'verified',
    'transferred',
    'sealed',
    'released',
  ])
  action!: string;
  @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
  @IsOptional() @IsUUID() to_custodian?: string;
  @IsOptional() @Matches(/^[0-9a-f]{64}$/i) integrity_hash?: string;
}
