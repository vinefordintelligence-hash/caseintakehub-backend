import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ReferencesService } from './references.service';
import { CreateReferenceDto } from './dto/create-reference.dto';
import { UpdateReferenceDto } from './dto/update-reference.dto';

@Controller('references')
export class ReferencesController {
  constructor(private readonly referencesService: ReferencesService) {}

  @Post()
  create(@Body() createReferenceDto: CreateReferenceDto) {
    return this.referencesService.create(createReferenceDto);
  }

  @Get()
  findAll() {
    return this.referencesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.referencesService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateReferenceDto: UpdateReferenceDto) {
    return this.referencesService.update(+id, updateReferenceDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.referencesService.remove(+id);
  }
}
