import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, Matches, MaxLength, MinLength } from 'class-validator';

export class ClientLoginDto {
  @ApiProperty({
    description:
      'Case Reference ID as shown on the client portal (e.g. VF-2026-8282).',
    example: 'VF-2026-8282',
  })
  @MinLength(3)
  @MaxLength(64)
  referenceId: string;

  @ApiProperty({
    description:
      'The email address registered for the authorized client of the case.',
    example: 'gayl302726@yahoo.com',
  })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({
    description: '6-digit client PIN for the case.',
    example: '123456',
  })
  @Matches(/^\d{6}$/, {
    message: 'PIN must be exactly 6 digits',
  })
  pin: string;
}
