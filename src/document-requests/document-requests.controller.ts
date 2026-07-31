import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { DocumentRequestsService } from './document-requests.service';
import { CreateDocumentRequestDto } from './dto/create-document-request.dto';
import { UpdateDocumentRequestDto } from './dto/update-document-request.dto';

@Controller('document-requests')
export class DocumentRequestsController {
  constructor(private readonly documentRequestsService: DocumentRequestsService) {}

  @Post()
  create(@Body() createDocumentRequestDto: CreateDocumentRequestDto) {
    return this.documentRequestsService.create(createDocumentRequestDto);
  }

  @Get()
  findAll() {
    return this.documentRequestsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documentRequestsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDocumentRequestDto: UpdateDocumentRequestDto) {
    return this.documentRequestsService.update(+id, updateDocumentRequestDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documentRequestsService.remove(+id);
  }
}
