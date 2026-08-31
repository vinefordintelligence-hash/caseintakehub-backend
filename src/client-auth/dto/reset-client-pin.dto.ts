import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class ResetClientPinDto {
  @ApiProperty({ example: 'VF-2026-8282' })
  @IsString({ message: 'Case reference must be a string' })
  @MaxLength(80, { message: 'Case reference is too long' })
  caseNumber!: string;

  @ApiProperty({ example: '482913', minLength: 6, maxLength: 6 })
  @IsString({ message: 'PIN must be supplied as a string' })
  @Matches(/^\d{6}$/, { message: 'PIN must be exactly 6 numeric digits' })
  newPin!: string;

  @ApiProperty({ example: '482913', minLength: 6, maxLength: 6 })
  @IsString({ message: 'PIN confirmation must be supplied as a string' })
  @Matches(/^\d{6}$/, {
    message: 'PIN confirmation must be exactly 6 numeric digits',
  })
  confirmPin!: string;
}
