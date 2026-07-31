import { PartialType } from '@nestjs/swagger';
import { CreateCaseTransferDto } from './create-case-transfer.dto';

export class UpdateCaseTransferDto extends PartialType(CreateCaseTransferDto) {}
