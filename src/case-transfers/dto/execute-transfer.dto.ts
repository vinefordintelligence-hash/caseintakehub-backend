import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ExecuteTransferDto {
  @ApiProperty({
    description:
      'Real operator-supplied bank transaction confirmation reference. Required for LIVE execution; demo/sandbox transfers can never be executed.',
    example: 'TXN-REF-2026-114000',
  })
  @IsString()
  @MinLength(3)
  confirmation_reference: string;
}
