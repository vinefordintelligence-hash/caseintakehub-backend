import { PartialType } from '@nestjs/swagger';
import { CreateFundingDto } from './create-funding.dto';

export class UpdateFundingDto extends PartialType(CreateFundingDto) {}
