import { PartialType } from '@nestjs/swagger';
import { CreateInvestigationDto } from './create-investigation.dto';
import { IsIn, IsOptional } from 'class-validator';

export class UpdateInvestigationDto extends PartialType(
  CreateInvestigationDto,
) {
  @IsOptional()
  @IsIn(['draft', 'reviewed', 'accepted', 'rejected'])
  status?: string;
}
