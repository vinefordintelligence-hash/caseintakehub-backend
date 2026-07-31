import { Injectable } from '@nestjs/common';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { UpdateInvestigationDto } from './dto/update-investigation.dto';

@Injectable()
export class InvestigationsService {
  create(createInvestigationDto: CreateInvestigationDto) {
    return 'This action adds a new investigation';
  }

  findAll() {
    return `This action returns all investigations`;
  }

  findOne(id: number) {
    return `This action returns a #${id} investigation`;
  }

  update(id: number, updateInvestigationDto: UpdateInvestigationDto) {
    return `This action updates a #${id} investigation`;
  }

  remove(id: number) {
    return `This action removes a #${id} investigation`;
  }
}
