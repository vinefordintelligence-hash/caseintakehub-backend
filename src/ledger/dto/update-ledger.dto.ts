import { PartialType } from '@nestjs/swagger';
import { CreateLedgerDto } from './create-ledger.dto';

export class UpdateLedgerDto extends PartialType(CreateLedgerDto) {}
