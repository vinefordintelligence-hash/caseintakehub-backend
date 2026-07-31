import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CaseTransfersService } from './case-transfers.service';
import { CreateCaseTransferDto } from './dto/create-case-transfer.dto';
import { UpdateCaseTransferDto } from './dto/update-case-transfer.dto';

@Controller('case-transfers')
export class CaseTransfersController {
  constructor(private readonly caseTransfersService: CaseTransfersService) {}

  @Post()
  create(@Body() createCaseTransferDto: CreateCaseTransferDto) {
    return this.caseTransfersService.create(createCaseTransferDto);
  }

  @Get()
  findAll() {
    return this.caseTransfersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.caseTransfersService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCaseTransferDto: UpdateCaseTransferDto) {
    return this.caseTransfersService.update(+id, updateCaseTransferDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.caseTransfersService.remove(+id);
  }
}
