import { ApiProperty } from '@nestjs/swagger';

export class SetLegalHoldDto {
  @ApiProperty({ example: true })
  enabled!: boolean;

  @ApiProperty({
    required: false,
    example: 'Frozen pending client confirmation',
  })
  note?: string;
}
