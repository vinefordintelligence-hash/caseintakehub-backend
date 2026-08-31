import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SendCaseMessageDto {
  @ApiProperty({
    description:
      'Message content sent within the authenticated case context (reuses the existing case messaging store).',
    example: 'Hello, please review my withdrawal request.',
  })
  @IsString()
  @MinLength(1)
  content: string;
}
