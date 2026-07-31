import { Injectable } from '@nestjs/common';
import { CreateCaseTransferDto } from './dto/create-case-transfer.dto';
import { UpdateCaseTransferDto } from './dto/update-case-transfer.dto';

@Injectable()
export class CaseTransfersService {
  create(createCaseTransferDto: CreateCaseTransferDto) {
    return 'This action adds a new caseTransfer';
  }

  findAll() {
    return `This action returns all caseTransfers`;
  }

  findOne(id: number) {
    return `This action returns a #${id} caseTransfer`;
  }

  update(id: number, updateCaseTransferDto: UpdateCaseTransferDto) {
    return `This action updates a #${id} caseTransfer`;
  }

  remove(id: number) {
    return `This action removes a #${id} caseTransfer`;
  }
}
