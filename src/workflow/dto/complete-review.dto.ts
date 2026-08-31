import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CompleteReviewDto {
  @ApiProperty({ example: '7b2abe2a-9312-42b8-a48d-408fd1771b77' })
  @IsUUID()
  case_id: string;
}
