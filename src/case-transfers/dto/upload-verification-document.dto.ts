import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UploadVerificationDocumentDto {
  @ApiProperty({ example: 'BANK ACCOUNT VERIFICATION DOCUMENT' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: 'bank_account_verification' })
  @IsOptional()
  @IsString()
  document_type?: string;

  @ApiPropertyOptional({ example: 'application/pdf' })
  @IsOptional()
  @IsString()
  mime_type?: string;

  @ApiPropertyOptional({ example: 'bank-account-verification.pdf' })
  @IsOptional()
  @IsString()
  file_name?: string;

  @ApiPropertyOptional({ example: 245760 })
  @IsOptional()
  @IsInt()
  @Min(0)
  file_size?: number;

  @ApiPropertyOptional({
    description:
      'Secure storage URL for the uploaded file. The backend stores metadata and the storage reference; binary content is not served from this API.',
  })
  @IsOptional()
  @IsString()
  file_url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
