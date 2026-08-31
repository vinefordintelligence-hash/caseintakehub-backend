import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TransferModeEnum {
  demo = 'demo',
  sandbox = 'sandbox',
  live = 'live',
}

export class CreateCaseTransferDto {
  @ApiProperty({ example: '7b2abe2a-9312-42b8-a48d-408fd1771b77' })
  @IsUUID()
  case_id: string;

  @ApiProperty({ example: 'a66e5f92-5c3c-42d5-b270-fba206ef5c0b' })
  @IsUUID()
  organization_id: string;

  @ApiProperty({ example: 'DEMO-VF20268282-0001' })
  @IsString()
  reference: string;

  @ApiProperty({ example: 114000 })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ enum: TransferModeEnum, default: 'demo' })
  @IsOptional()
  @IsEnum(TransferModeEnum)
  mode?: TransferModeEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiving_institution?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiving_city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiving_country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiving_routing?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiving_account?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiving_account_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  beneficiary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  beneficiary_legal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  prepared_by?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
