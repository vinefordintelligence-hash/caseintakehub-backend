import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateNotificationDto {
  @ApiProperty()
  @IsUUID()
  case_id!: string;

  @ApiProperty({ enum: ['client', 'admin'] })
  @IsIn(['client', 'admin'])
  recipient_role!: 'client' | 'admin';

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;
}
