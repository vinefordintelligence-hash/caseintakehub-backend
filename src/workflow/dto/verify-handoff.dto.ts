import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class VerifyHandoffDto {
  @ApiProperty({
    description:
      'Signed Phase 6 handoff token issued via the issue endpoint. The downstream portal presents this token; it is re-validated against live workflow state.',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJncmFudF9pZCI6InV1aWQifQ.signature',
  })
  @IsString()
  @MinLength(16)
  token: string;
}
