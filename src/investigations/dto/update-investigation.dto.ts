import { PartialType } from '@nestjs/swagger';
import { CreateInvestigationDto } from './create-investigation.dto';

export class UpdateInvestigationDto extends PartialType(CreateInvestigationDto) {}
