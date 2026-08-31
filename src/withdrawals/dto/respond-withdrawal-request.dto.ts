import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RespondWithdrawalRequestDto {
  @ApiProperty({
    description:
      'Client response to a more-information request. Returns the withdrawal request to pending_review.',
    example:
      'Beneficiary legal name: Gayl M. Chenoweth; account type: savings.',
  })
  @IsString()
  @MinLength(1)
  response: string;
}
