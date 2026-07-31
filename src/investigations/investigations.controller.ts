import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { InvestigationsService } from './investigations.service';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { UpdateInvestigationDto } from './dto/update-investigation.dto';

@Controller('investigations')
export class InvestigationsController {
  constructor(private readonly investigationsService: InvestigationsService) {}

  @Post()
  create(@Body() createInvestigationDto: CreateInvestigationDto) {
    return this.investigationsService.create(createInvestigationDto);
  }

  @Get()
  findAll() {
    return this.investigationsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.investigationsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateInvestigationDto: UpdateInvestigationDto) {
    return this.investigationsService.update(+id, updateInvestigationDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.investigationsService.remove(+id);
  }
}
