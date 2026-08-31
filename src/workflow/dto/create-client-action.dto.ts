import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateClientActionDto {
  @ApiProperty({
    example: 'Next Authorized Client Action',
    description: 'Configurable title for the next authorized client action.',
  })
  @IsString()
  title: string;

  @ApiPropertyOptional({
    example:
      'Your documents have been verified. You may now authorize the next step in your case.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example:
      'https://portal.vineford.local/actions/7b2abe2a-9312-42b8-a48d-408fd1771b77',
  })
  @IsOptional()
  @IsString()
  action_url?: string;

  @ApiPropertyOptional({ example: 'Authorize Next Step' })
  @IsOptional()
  @IsString()
  action_label?: string;

  @ApiPropertyOptional({
    example: '2026-09-14T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  expires_at?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_client_visible?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
